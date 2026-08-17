# Dibbs War Target Board

A static Torn war-room page for scouting an opposing faction and calling dibs on targets.

## Use

1. Enter a callsign and select **Open war room** for the demo roster, or load an enemy faction with a Torn API key.
2. Use **Dibs** to reserve a target. Claims are stored in browser local storage by faction.
3. Use **All**, **Open**, and **Mine** to manage the queue. The owner of a claim can release it.

For a truly shared board across devices, replace the local storage claim store in `script.js` with a small realtime backend. API keys are entered at runtime and are not embedded in the page.
