# hale

> /heɪl/ – HAIL

> *n.* – from Old English *hāl*, meaning “whole” or “healthy.”

> *Hale* takes its name from the idea of whole-person health. It is a healthcare memory aid that helps people and families keep care conversations and important details within reach. It supports remembering—not diagnosis or treatment—and does not replace professional care.

> *healthcare, remembered.*

## apps

- `apps/web`: web patient and family dashboards.
- `apps/mobile`: Android Expo patient companion, migrated from `reference/mobile`. Windows is supported: install with `bun run mobile:android`, then use `bun run dev:mobile:usb` for Fast Refresh; see [Android setup and recording verification](apps/mobile/README.md).
- Both clients share `packages/contracts` and the Convex backend. Native background capture is implemented but requires physical-device verification before release; Expo Go does not support this configuration.

## todo

- [x] account signup, patient and family flows

### patient dashboard

- [x] patient dashboard
- [x] patient-space onboarding
- [x] foreground web recording
- [x] audio upload
- [x] searchable conversations
- [x] calendar timeline
- [x] source-linked recall
- [x] patient-space access checks
- [ ] audio transcription
- [ ] memory extraction
- [ ] speaker matching
- [ ] nightly summaries
- [x] Expo Android capture implementation
- [x] native background recording configuration and durable upload queue
- [ ] physical-device background capture verification
- [ ] smartwatch and wearable capture

### family dashboard

- [x] family dashboard
- [x] family profile onboarding
- [x] consented voice enrollment
- [ ] family invitations
