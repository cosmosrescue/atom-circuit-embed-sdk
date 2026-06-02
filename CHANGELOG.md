# Changelog

All notable changes to this project are documented in this file. The format
follows Keep a Changelog (https://keepachangelog.com/en/1.1.0/), and this
project adheres to Semantic Versioning (https://semver.org/spec/v2.0.0.html).

## [1.3.0] - 2026-06-02

### Added

- `allowReferralChoice` option on `mount()` and `<AtomCircuitSwap />`. When `true`, the embed renders a picker of all participating validators with `referralId` as the pre-selected default, letting the end user choose which validator the affiliate fee is staked to; the choice persists across reloads. Default `false` leaves the existing fixed-`referralId` behaviour unchanged (the flag is omitted from the config payload when off).

## [1.2.2] - 2026-06-02

- Minor change.

## [1.2.1] - 2026-05-29

- Initial public release.
