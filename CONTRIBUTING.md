# Contributing to Inkbox

Thank you for your interest in contributing to Inkbox!

## Location Restrictions

**We do not accept pull requests from contributors located in Bangladesh or India.**

To maintain the integrity of our contributor community and ensure meaningful contributions:

- PRs from accounts with Bangladesh or India listed in their GitHub profile location will be automatically rejected
- Contributors must have a valid location set in their GitHub profile
- Our CI includes automated location verification using the GitHub API
- Attempts to circumvent this restriction will result in rejection

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
