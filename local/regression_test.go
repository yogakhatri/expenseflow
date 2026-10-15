package main

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

func testApp(t *testing.T) *App {
	t.Helper()
	dir := t.TempDir()
	cfg := loadConfig()
	cfg.DBPath = filepath.Join(dir, "expenseflow.db")
	cfg.BackupDir = filepath.Join(dir, "backups")
	cfg.MigrationDir, _ = filepath.Abs("../db/migrations")
	if err := os.MkdirAll(cfg.BackupDir, 0o700); err != nil {
		t.Fatal(err)
	}
	app, err := newApp(cfg)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = app.db.Close() })
	return app
}

func testAPI(app *App, method, path string, body any) *httptest.ResponseRecorder {
	data, _ := json.Marshal(body)
	req := httptest.NewRequest(method, path, bytes.NewReader(data))
	req.Header.Set("X-Local-Date", "2026-10-15")
	mux := http.NewServeMux()
	app.routes(mux)
	response := httptest.NewRecorder()
	app.securityMiddleware(mux).ServeHTTP(response, req)
	return response
}

func testExpense(description string) TransactionInput {
	account := int64(1)
	return TransactionInput{AmountPaise: 50000, Description: description, CategoryID: 3, PaymentMethodID: 1, AccountID: &account, TransactionDate: "2026-10-15"}
}

func TestBootstrapRunsScheduledBackupOncePerPeriod(t *testing.T) {
	for _, schedule := range []string{"daily", "weekly"} {
		t.Run(schedule, func(t *testing.T) {
			app := testApp(t)
			if _, err := app.db.Exec("UPDATE settings SET value=? WHERE key='backup_schedule'", schedule); err != nil {
				t.Fatal(err)
			}
			if _, _, err := app.createTransaction(testExpense("Snapshot fixture")); err != nil {
				t.Fatal(err)
			}
			var wg sync.WaitGroup
			for i := 0; i < 8; i++ {
				wg.Add(1)
				go func() {
					defer wg.Done()
					if response := testAPI(app, "GET", "/api/bootstrap", nil); response.Code != 200 {
						t.Errorf("bootstrap: %s", response.Body)
					}
				}()
			}
			wg.Wait()
			matches, _ := filepath.Glob(filepath.Join(app.cfg.BackupDir, "*_auto-"+schedule+".db"))
			if len(matches) != 1 {
				t.Fatalf("got %d scheduled backups, want 1", len(matches))
			}
			backup, err := openDB(matches[0])
			if err != nil {
				t.Fatal(err)
			}
			defer backup.Close()
			var n int
			if err := backup.QueryRow("SELECT COUNT(*) FROM transactions").Scan(&n); err != nil || n != 1 {
				t.Fatalf("snapshot rows=%d err=%v", n, err)
			}
			nextDate := "2026-10-16"
			if schedule == "weekly" {
				nextDate = "2026-10-22"
			}
			app.maybeAutoBackup(nextDate)
			matches, _ = filepath.Glob(filepath.Join(app.cfg.BackupDir, "*_auto-"+schedule+".db"))
			if len(matches) != 2 {
				t.Fatalf("next period: got %d backups, want 2", len(matches))
			}
		})
	}
}

func TestRestoreMigratesBeforeReplacingDatabase(t *testing.T) {
	app := testApp(t)
	legacyDir := t.TempDir()
	entries, err := os.ReadDir(app.cfg.MigrationDir)
	if err != nil {
		t.Fatal(err)
	}
	for _, entry := range entries {
		if entry.Name() >= "005" {
			continue
		}
		data, err := os.ReadFile(filepath.Join(app.cfg.MigrationDir, entry.Name()))
		if err != nil {
			t.Fatal(err)
		}
		if err = os.WriteFile(filepath.Join(legacyDir, entry.Name()), data, 0o600); err != nil {
			t.Fatal(err)
		}
	}
	cfg := app.cfg
	cfg.MigrationDir = legacyDir
	cfg.DBPath = filepath.Join(t.TempDir(), "legacy.db")
	legacy, err := newApp(cfg)
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err = legacy.createTransaction(testExpense("Restored fixture")); err != nil {
		t.Fatal(err)
	}
	if err = legacy.createBackup("legacy"); err != nil {
		t.Fatal(err)
	}
	_ = legacy.db.Close()
	files, _ := filepath.Glob(filepath.Join(app.cfg.BackupDir, "*_legacy.db"))
	if len(files) != 1 {
		t.Fatal("legacy backup missing")
	}
	response := testAPI(app, "POST", "/api/restore", map[string]string{"name": filepath.Base(files[0])})
	if response.Code != 200 {
		t.Fatalf("restore: %s", response.Body)
	}
	if version := app.currentSchemaVersion(); version != 7 {
		t.Fatalf("restored schema=%d", version)
	}
	var description string
	if err = app.db.QueryRow("SELECT description FROM transactions").Scan(&description); err != nil || description != "Restored fixture" {
		t.Fatalf("restored data: %q %v", description, err)
	}
	income := testAPI(app, "POST", "/api/income", map[string]any{"amount_paise": 10000, "source": "Fixture", "income_date": "2026-10-15"})
	if income.Code != 201 {
		t.Fatalf("income after restore: %s", income.Body)
	}
	source, err := openDB(files[0])
	if err != nil {
		t.Fatal(err)
	}
	defer source.Close()
	var sourceVersion int
	if err = source.QueryRow("SELECT MAX(version) FROM schema_version").Scan(&sourceVersion); err != nil || sourceVersion != 4 {
		t.Fatalf("source backup changed: %d %v", sourceVersion, err)
	}
}

func TestFailedRestoreMigrationPreservesLiveDatabase(t *testing.T) {
	app := testApp(t)
	if err := app.createBackup("fixture"); err != nil {
		t.Fatal(err)
	}
	if _, _, err := app.createTransaction(testExpense("Keep live data")); err != nil {
		t.Fatal(err)
	}
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "008_broken.sql"), []byte("INVALID SQL"), 0o600); err != nil {
		t.Fatal(err)
	}
	app.cfg.MigrationDir = dir
	files, _ := filepath.Glob(filepath.Join(app.cfg.BackupDir, "*_fixture.db"))
	response := testAPI(app, "POST", "/api/restore", map[string]string{"name": filepath.Base(files[0])})
	if response.Code != 400 {
		t.Fatalf("failed restore: %d %s", response.Code, response.Body)
	}
	var count int
	if err := app.db.QueryRow("SELECT COUNT(*) FROM transactions").Scan(&count); err != nil || count != 1 {
		t.Fatalf("live data lost: %d %v", count, err)
	}
}

func TestConcurrentBulkSavesRejectDuplicates(t *testing.T) {
	app := testApp(t)
	start := make(chan struct{})
	responses := make(chan int, 32)
	for i := 0; i < 32; i++ {
		go func() {
			<-start
			response := testAPI(app, "POST", "/api/transactions/bulk", map[string]any{"items": []TransactionInput{testExpense("Concurrent fixture")}})
			responses <- response.Code
		}()
	}
	close(start)
	created := 0
	for i := 0; i < 32; i++ {
		switch status := <-responses; status {
		case 201:
			created++
		case 409:
		default:
			t.Errorf("unexpected status %d", status)
		}
	}
	if created != 1 {
		t.Fatalf("created %d identical batches", created)
	}
	response := testAPI(app, "POST", "/api/transactions/bulk", map[string]any{"items": []TransactionInput{testExpense("Concurrent fixture")}, "allow_duplicates": true})
	if response.Code != 201 {
		t.Fatalf("explicit duplicate: %s", response.Body)
	}
}

func TestSharedInputContract(t *testing.T) {
	app := testApp(t)
	data, err := os.ReadFile("../testdata/input-contract.json")
	if err != nil {
		t.Fatal(err)
	}
	var contract struct {
		Dates []struct {
			Value string `json:"value"`
			Valid bool   `json:"valid"`
		} `json:"dates"`
		Rules []struct {
			Keyword    string `json:"keyword"`
			Merchant   string `json:"merchant"`
			CategoryID int64  `json:"category_id"`
			Priority   int    `json:"priority"`
			Enabled    bool   `json:"enabled"`
		} `json:"rules"`
		QuickInputs []struct {
			Text       string `json:"text"`
			CategoryID int64  `json:"category_id"`
		} `json:"quick_inputs"`
	}
	if err = json.Unmarshal(data, &contract); err != nil {
		t.Fatal(err)
	}
	for _, x := range contract.Dates {
		if validateDate(x.Value) != x.Valid {
			t.Errorf("date %q", x.Value)
		}
	}
	for _, r := range contract.Rules {
		if _, err = app.db.Exec("INSERT INTO categorization_rules(keyword,merchant,category_id,priority,enabled) VALUES(?,?,?,?,?)", r.Keyword, r.Merchant, r.CategoryID, r.Priority, boolInt(r.Enabled)); err != nil {
			t.Fatal(err)
		}
	}
	for _, x := range contract.QuickInputs {
		items, err := app.parseComma(x.Text, "2026-10-15")
		if err != nil {
			t.Fatal(err)
		}
		if len(items) != 1 || items[0].CategoryID != x.CategoryID {
			t.Errorf("input %q: %#v", x.Text, items)
		}
	}
}

func TestAIResponseCanOutlastOrdinaryWriteDeadline(t *testing.T) {
	app := testApp(t)
	server := httptest.NewUnstartedServer(app.securityMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		time.Sleep(60 * time.Millisecond)
		writeJSON(w, 200, map[string]bool{"ok": true})
	})))
	server.Config.WriteTimeout = 20 * time.Millisecond
	server.Start()
	defer server.Close()
	response, err := server.Client().Get(server.URL + "/api/ai/test")
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	body, err := io.ReadAll(response.Body)
	if err != nil || response.StatusCode != 200 || !strings.Contains(string(body), `"ok":true`) {
		t.Fatalf("response: %s %v", body, err)
	}
}

func TestRestoreWaitsForActiveAPIReaders(t *testing.T) {
	app := testApp(t)
	readerEntered := make(chan struct{})
	releaseReader := make(chan struct{})
	restoreEntered := make(chan struct{})
	readerDone := make(chan struct{})
	restoreDone := make(chan struct{})
	handler := app.securityMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/restore" {
			close(restoreEntered)
		} else {
			close(readerEntered)
			<-releaseReader
		}
		w.WriteHeader(200)
	}))
	go func() {
		defer close(readerDone)
		handler.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest("GET", "/api/bootstrap", nil))
	}()
	<-readerEntered
	go func() {
		defer close(restoreDone)
		handler.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest("POST", "/api/restore", nil))
	}()
	select {
	case <-restoreEntered:
		t.Error("restore entered while a reader was active")
	case <-time.After(20 * time.Millisecond):
	}
	close(releaseReader)
	<-readerDone
	select {
	case <-restoreDone:
	case <-time.After(time.Second):
		t.Fatal("restore did not resume after the reader completed")
	}
}
