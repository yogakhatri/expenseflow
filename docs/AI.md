# Optional AI

AI is disabled by default. The deterministic quick parser works without it.

## Recommended model

```text
Default: qwen3.5:4b
Lower-memory option: qwen3.5:2b
Higher-accuracy option: qwen3.5:9b
```

`qwen3.5:4b` is the default balance for English, Hindi/Hinglish and structured extraction.

## Structured parsing contract

ExpenseFlow calls Ollama `/api/chat` with:

```text
stream: false
think: false
temperature: 0
context: 4096
format: strict JSON Schema
```

The schema constrains every item to amount, description, one allowed category, one allowed payment method, ISO date, notes and review state. The server validates the returned JSON again and maps names to database IDs. AI never saves directly.

The prompt explicitly handles casual punctuation, repeated spaces, new lines, Indian-formatted amounts, English, Hindi and Hinglish. Unknown or inferred fields are marked for review.

## URLs

```text
Same Docker Compose stack: http://ollama:11434
ExpenseFlow Docker + Ollama on host: http://host.docker.internal:11434
Both native: http://127.0.0.1:11434
```

**Test connection** runs an actual schema-constrained request. “AI Ready” therefore means both connectivity and structured-output compatibility passed.

Leave **Unload immediately** off for faster repeated parsing. ExpenseFlow keeps the model warm for about five minutes, then Ollama may release it.

The model receives no database, filesystem, shell, Docker or arbitrary tool access.
