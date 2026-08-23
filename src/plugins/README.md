# furinapet plugin architecture

The plugin system follows the same high-level boundary used by OpenPets: the desktop host owns plugin state, event dispatch and privileged side effects; renderer windows are only UI/sensor surfaces.

## Current v1 architecture

```text
Pet WebView
  └─ dom-bridge.ts
      └─ invoke publish_pet_event
           ↓
Tauri / Rust Plugin Host
  ├─ persistent enabled state
  ├─ curated pet event dispatch
  ├─ plugin runtime state
  └─ host-owned pet reactions
           ↑
Control Center
  └─ PluginNavigation.tsx
      ├─ list_plugins
      └─ set_plugin_enabled
```

The pet renderer does not decide whether an interaction belongs to a plugin. It only reports a curated event. The Rust host decides whether an enabled plugin consumes the event and performs the resulting pet action.

This avoids keeping separate plugin runtimes in the `main` and `pet` WebViews.

## Built-in v1 plugin

`click-reaction` currently lives in `src-tauri/src/plugin_host.rs` and demonstrates host arbitration:

- single click → random reaction + bubble
- three clicks within 1.8 seconds → stronger jumping reaction
- double click → plugin reaction when enabled
- when disabled, the existing built-in double-click reaction remains the fallback

Plugin enabled state is persisted under the Tauri app-data directory in `plugin-state.json`.

## Next stage: external JavaScript plugins

The next runtime should keep the same host boundary rather than executing downloaded code inside either application renderer.

Recommended layout:

```text
plugin package
  ↓ manifest validation / permissions
sandboxed plugin WebviewWindow
  ↓ narrow SDK requests
Rust Plugin Host
  ↓ permission validation
pet / storage / network / UI capabilities
```

The Control Center should only install, configure, enable and inspect plugins. Pet windows should only publish curated senses such as click, double-click, drag and hover. All privileged behavior should remain host-mediated.
