# Changelog

All notable changes to mac-dashboard are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- A sidebar, and a Background page that lists everything running that you can't see: Docker containers, programs, services and apps with no Dock icon, with their ports, running time, processor use and memory.
- A small second sidebar on both pages. It lists the page's groups with their totals and shows one group at a time, so the page fits your window instead of scrolling.

### Fixed

- Python programs started from Homebrew's framework build are now named after their folder.
- Info tooltips no longer make the page wider than a narrow window.
- A server error now shows its own message instead of saying the server can't be reached.

## [1.0.0] - 2026-10-31

### Added

- A verdict on whether your Mac is fine, short on RAM or out of RAM, from macOS's own memory pressure.
- Needs attention: a card for each thing that is too much, with what to do about it.
- Memory, processor and disk at a glance, including swap.
- Using memory: hundreds of processes grouped into the apps you know, with what is inside each one.
- Space you can free: caches and build folders over 300 MB, measured once an hour.
- Start at login with `mac-dashboard enable`.
- The `start`, `stop`, `restart`, `status`, `disable` and `update` commands.

[1.0.0]: https://github.com/DevKazonovic/mac-dashboard/releases/tag/v1.0.0
