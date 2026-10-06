package main

import (
	"os"
	"strconv"
)

const appVersion = "0.6.0"

type Config struct {
	Addr          string
	DBPath        string
	WebDir        string
	MigrationDir  string
	BackupDir     string
	AIEnabled     bool
	AIURL         string
	AIModel       string
	AIUnload      bool
	MaxBodyBytes  int64
	MaxBulkItems  int
	MaxAIInputLen int
}

func loadConfig() Config {
	return Config{
		Addr:          env("EXPENSEFLOW_ADDR", "127.0.0.1:8787"),
		DBPath:        env("EXPENSEFLOW_DB", "./data/expenseflow.db"),
		WebDir:        env("EXPENSEFLOW_WEB_DIR", "./web"),
		MigrationDir:  env("EXPENSEFLOW_MIGRATIONS", "./db/migrations"),
		BackupDir:     env("EXPENSEFLOW_BACKUP_DIR", "./data/backups"),
		AIEnabled:     envBool("EXPENSEFLOW_AI_ENABLED", false),
		AIURL:         env("EXPENSEFLOW_AI_URL", "http://127.0.0.1:11434"),
		AIModel:       env("EXPENSEFLOW_AI_MODEL", "qwen3.5:4b"),
		AIUnload:      envBool("EXPENSEFLOW_AI_UNLOAD", false),
		MaxBodyBytes:  1 << 20,
		MaxBulkItems:  500,
		MaxAIInputLen: 20_000,
	}
}

func env(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func envBool(key string, fallback bool) bool {
	v := os.Getenv(key)
	if v == "" {
		return fallback
	}
	b, err := strconv.ParseBool(v)
	if err != nil {
		return fallback
	}
	return b
}
