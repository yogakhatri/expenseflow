package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestExpenseSchemaUsesAllowedEnums(t *testing.T) {
	schema := expenseJSONSchema([]string{"Food", "Other"}, []string{"Cash", "UPI"})
	properties := schema["properties"].(map[string]any)
	items := properties["items"].(map[string]any)
	item := items["items"].(map[string]any)
	fields := item["properties"].(map[string]any)
	categories := fields["category"].(map[string]any)["enum"].([]string)
	if len(categories) != 2 || categories[0] != "Food" || categories[1] != "Other" {
		t.Fatalf("unexpected category enum: %#v", categories)
	}
}

func TestPostOllamaStructuredAcceptsSchemaContent(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/chat" {
			t.Fatalf("unexpected path: %s", r.URL.Path)
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"message": map[string]any{"content": `{"ok":true}`},
		})
	}))
	defer server.Close()

	var out struct {
		OK bool `json:"ok"`
	}
	if err := postOllamaStructured(server.URL, map[string]any{"model": "test"}, time.Second, &out); err != nil {
		t.Fatal(err)
	}
	if !out.OK {
		t.Fatal("expected ok=true")
	}
}

func TestPostOllamaStructuredRejectsUnknownFields(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{
			"message": map[string]any{"content": `{"ok":true,"extra":1}`},
		})
	}))
	defer server.Close()

	var out struct {
		OK bool `json:"ok"`
	}
	if err := postOllamaStructured(server.URL, map[string]any{"model": "test"}, time.Second, &out); err == nil {
		t.Fatal("expected strict JSON decoding failure")
	}
}
