package main

import (
	"net/http"
	"net/url"
	"strings"
	"time"
)

func (a *App) securityMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "no-referrer")
		w.Header().Set("Permissions-Policy", "camera=(), microphone=(self), geolocation=()")
		w.Header().Set("Content-Security-Policy", "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'")
		w.Header().Set("Cache-Control", apiCacheControl(r.URL.Path))
		if isMutation(r.Method) && strings.HasPrefix(r.URL.Path, "/api/") && !sameOriginRequest(r) {
			writeError(w, http.StatusForbidden, "Cross-site request rejected")
			return
		}
		// Restoring replaces the database handle. Wait for active API requests and
		// keep new readers and writers out until the replacement is ready.
		if strings.HasPrefix(r.URL.Path, "/api/") {
			if strings.HasPrefix(r.URL.Path, "/api/ai/") {
				// Model loading and extraction can exceed the ordinary 30s deadline.
				_ = http.NewResponseController(w).SetWriteDeadline(time.Now().Add(aiResponseTimeout))
			}
			if r.URL.Path == "/api/restore" && r.Method == http.MethodPost {
				a.dbMu.Lock()
				defer a.dbMu.Unlock()
			} else {
				a.dbMu.RLock()
				defer a.dbMu.RUnlock()
			}
		}
		next.ServeHTTP(w, r)
	})
}

func apiCacheControl(path string) string {
	if strings.HasPrefix(path, "/api/") {
		return "no-store"
	}
	return "no-cache"
}

func isMutation(method string) bool {
	return method == http.MethodPost || method == http.MethodPut || method == http.MethodPatch || method == http.MethodDelete
}

func sameOriginRequest(r *http.Request) bool {
	if site := r.Header.Get("Sec-Fetch-Site"); site != "" {
		return site == "same-origin" || site == "none"
	}
	origin := r.Header.Get("Origin")
	if origin == "" {
		return true
	}
	u, err := url.Parse(origin)
	if err != nil {
		return false
	}
	return strings.EqualFold(u.Host, r.Host)
}
