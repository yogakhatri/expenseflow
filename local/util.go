package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"
)

var dateRE = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}$`)

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]any{"error": message})
}

func decodeJSON(w http.ResponseWriter, r *http.Request, dst any, max int64) bool {
	r.Body = http.MaxBytesReader(w, r.Body, max)
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(dst); err != nil {
		var mbe *http.MaxBytesError
		if errors.As(err, &mbe) {
			writeError(w, http.StatusRequestEntityTooLarge, "Request is too large")
		} else {
			writeError(w, http.StatusBadRequest, "Invalid JSON request")
		}
		return false
	}
	return true
}

func parseAmountPaise(s string) (int64, error) {
	s = strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(s), "₹"))
	if s == "" {
		return 0, fmt.Errorf("empty amount")
	}
	if strings.HasPrefix(s, "+") {
		s = strings.TrimPrefix(s, "+")
	}
	if strings.HasPrefix(s, "-") {
		return 0, fmt.Errorf("amount must be positive")
	}
	parts := strings.Split(s, ".")
	if len(parts) > 2 {
		return 0, fmt.Errorf("invalid amount")
	}
	whole := parts[0]
	if whole == "" {
		whole = "0"
	}
	w, err := strconv.ParseInt(whole, 10, 64)
	if err != nil {
		return 0, fmt.Errorf("invalid amount")
	}
	frac := int64(0)
	if len(parts) == 2 {
		f := parts[1]
		if len(f) > 2 {
			return 0, fmt.Errorf("amount supports at most 2 decimals")
		}
		if len(f) == 1 {
			f += "0"
		}
		if f == "" {
			f = "00"
		}
		frac, err = strconv.ParseInt(f, 10, 64)
		if err != nil {
			return 0, fmt.Errorf("invalid amount")
		}
	}
	if w < 0 || w > (1<<63-1-frac)/100 {
		return 0, fmt.Errorf("amount is too large")
	}
	return w*100 + frac, nil
}

func formatPaiseDecimal(p int64) string {
	return fmt.Sprintf("%d.%02d", p/100, p%100)
}

func normalize(s string) string {
	return strings.Join(strings.Fields(strings.ToLower(strings.TrimSpace(s))), " ")
}

func fingerprint(in TransactionInput) string {
	account := int64(0)
	if in.AccountID != nil {
		account = *in.AccountID
	}
	raw := fmt.Sprintf("%s|%d|%s|%d|%d", in.TransactionDate, in.AmountPaise, normalize(in.Description), in.PaymentMethodID, account)
	sum := sha256.Sum256([]byte(raw))
	return hex.EncodeToString(sum[:])
}

func validateDate(s string) bool {
	if !dateRE.MatchString(s) {
		return false
	}
	_, err := time.Parse("2006-01-02", s)
	return err == nil
}

func todayFromHeader(r *http.Request) string {
	if d := r.Header.Get("X-Local-Date"); validateDate(d) {
		return d
	}
	return time.Now().Format("2006-01-02")
}

func parseIntQuery(r *http.Request, key string, def int) int {
	v, err := strconv.Atoi(r.URL.Query().Get(key))
	if err != nil {
		return def
	}
	return v
}
