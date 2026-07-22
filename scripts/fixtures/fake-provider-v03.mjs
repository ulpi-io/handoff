#!/usr/bin/env node
// The v0.3 fake-provider entry point deliberately shares the hermetic provider implementation.
// Keeping a distinct path lets the release suite prove that v0.3 fixtures are present without
// creating a second behavior surface.
await import('./fake-provider.mjs');
