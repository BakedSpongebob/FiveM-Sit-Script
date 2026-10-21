# Sit Script
A lightweight FiveM open-source script that allows players to sit and stand up.

/sit to sit and /stand to stand up

## FiveBoard — planning board app for macOS

This repo also contains **[FiveBoard](fiveboard/)**, a Mac app for planning and exploring FiveM scripts. It's a grey, infinite board where you can drop notes, images and files, tie them together with yarn, and import whole resource folders to see every file, its code, and how the manifest, events, callbacks and NUI connect.

```bash
cd fiveboard && npm install && npm start
```

See [fiveboard/README.md](fiveboard/README.md) for features and how to build the `.dmg`. The app folder isn't part of the FiveM resource: `fxmanifest.lua` only loads `client.lua`.
