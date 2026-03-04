# Changelog

## [Unreleased]
### Added
- Generate: Undo Enhance button and Recent prompts (last 5) dropdown for positive prompts.
- Gallery: Edit Image modal (runs Qwen Image Edit workflow on selected image).
- Gallery: Icon buttons for download/redo/favorite/rename/delete (Animate kept for images).

### Changed
- Gallery: Removed Show Prompt and Repair actions (no longer depends on legacy .meta.json).

### Fixed
- Enhance Prompt: tightened enhancement rules to reduce prompt drift (avoid adding new characters/objects/locations/camera changes).
