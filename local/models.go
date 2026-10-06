package main

type TransactionInput struct {
	ID              int64    `json:"id,omitempty"`
	AmountPaise     int64    `json:"amount_paise"`
	Description     string   `json:"description"`
	CategoryID      int64    `json:"category_id"`
	PaymentMethodID int64    `json:"payment_method_id"`
	AccountID       *int64   `json:"account_id,omitempty"`
	TransactionDate string   `json:"transaction_date"`
	Notes           string   `json:"notes"`
	RawInput        string   `json:"raw_input"`
	Source          string   `json:"source"`
	AIConfidence    *float64 `json:"ai_confidence,omitempty"`
	AIModel         string   `json:"ai_model,omitempty"`
	AIProcessed     bool     `json:"ai_processed"`
	Version         int64    `json:"version,omitempty"`
}

type Transaction struct {
	TransactionInput
	CategoryName      string `json:"category_name"`
	PaymentMethodName string `json:"payment_method_name"`
	AccountName       string `json:"account_name"`
	Fingerprint       string `json:"fingerprint"`
	CreatedAt         string `json:"created_at"`
	UpdatedAt         string `json:"updated_at"`
}

type PreviewItem struct {
	AmountPaise     int64  `json:"amount_paise"`
	Description     string `json:"description"`
	CategoryID      int64  `json:"category_id"`
	CategoryName    string `json:"category_name"`
	PaymentMethodID int64  `json:"payment_method_id"`
	PaymentName     string `json:"payment_name"`
	AccountID       *int64 `json:"account_id,omitempty"`
	TransactionDate string `json:"transaction_date"`
	Notes           string `json:"notes"`
	RawInput        string `json:"raw_input"`
	Source          string `json:"source"`
	NeedsReview     bool   `json:"needs_review"`
	Warning         string `json:"warning,omitempty"`
}
