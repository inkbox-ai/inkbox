# Contributing to Inkbox

Thank you for your interest in contributing to Inkbox!

## AI-Generated PRs

**We do not accept AI-generated pull requests for contributor status.**

To maintain the integrity of our contributor community and ensure meaningful contributions:

- PRs must be genuinely written by humans
- AI tools may be used as assistants, but the final submission must be human-curated and reviewed
- Our CI includes automated detection for AI-generated patterns
- Suspicious PRs will be flagged for additional review
- Attempts to game the system with AI-generated content will result in rejection

## What we look for

- Meaningful improvements to the codebase
- Well-tested changes
- Clear, specific commit messages and PR descriptions
- Genuine engagement with the project

## Getting Started

1. Fork the repository
2. Create a branch for your feature or bugfix
3. Make your changes with clear, descriptive commit messages
4. Ensure all tests pass
5. Submit a pull request with a human-written description

## Development Setup

See the README for setup instructions for each SDK (Python, TypeScript, Rust, CLI).

## Testing

Run the test suite before submitting:

```bash
# Python
cd sdk/python
pytest --cov

# TypeScript
cd sdk/typescript
npm test

# Rust
cd sdk/rust
cargo test

# CLI
cd cli
npm test
```

## Code Style

- Python: Follow PEP 8, use ruff for linting
- TypeScript: Use the provided ESLint configuration
- Rust: Use `cargo fmt` and `cargo clippy`

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
