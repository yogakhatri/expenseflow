package main

import (
	"encoding/json"
	"net/http"
)

func (a *App) handlePending(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		rows, err := a.db.Query(`SELECT id,status,raw_input,payload_json,created_at,updated_at FROM pending_entries WHERE status<>'SAVED' ORDER BY id DESC LIMIT 200`)
		if err != nil {
			writeError(w, 500, "Could not load pending entries")
			return
		}
		defer rows.Close()
		items := []map[string]any{}
		for rows.Next() {
			var id int64
			var status, raw, payload, created, updated string
			if rows.Scan(&id, &status, &raw, &payload, &created, &updated) == nil {
				var p any
				_ = json.Unmarshal([]byte(payload), &p)
				items = append(items, map[string]any{"id": id, "status": status, "raw_input": raw, "payload": p, "created_at": created, "updated_at": updated})
			}
		}
		writeJSON(w, 200, map[string]any{"items": items})
	case http.MethodPut:
		var req struct {
			ID       int64  `json:"id"`
			Status   string `json:"status"`
			RawInput string `json:"raw_input"`
			Payload  any    `json:"payload"`
		}
		if !decodeJSON(w, r, &req, a.cfg.MaxBodyBytes) {
			return
		}
		valid := req.Status == "RAW" || req.Status == "PARSED" || req.Status == "REVIEW_NEEDED" || req.Status == "SAVED"
		if !valid || len(req.RawInput) > 20000 {
			writeError(w, 400, "Invalid pending entry")
			return
		}
		body, _ := json.Marshal(req.Payload)
		if len(body) > 200000 {
			writeError(w, 413, "Pending payload too large")
			return
		}
		a.writeMu.Lock()
		defer a.writeMu.Unlock()
		if req.ID > 0 {
			_, err := a.db.Exec(`UPDATE pending_entries SET status=?,raw_input=?,payload_json=?,updated_at=datetime('now') WHERE id=?`, req.Status, req.RawInput, string(body), req.ID)
			if err != nil {
				writeError(w, 500, "Could not save pending entry")
				return
			}
			writeJSON(w, 200, map[string]any{"id": req.ID})
			return
		}
		res, err := a.db.Exec(`INSERT INTO pending_entries(status,raw_input,payload_json) VALUES(?,?,?)`, req.Status, req.RawInput, string(body))
		if err != nil {
			writeError(w, 500, "Could not save pending entry")
			return
		}
		id, _ := res.LastInsertId()
		writeJSON(w, 201, map[string]any{"id": id})
	default:
		w.WriteHeader(http.StatusMethodNotAllowed)
	}
}
