ConnectionStatus (ComfyUI connectivity badge)

Files:
- app/components/ConnectionStatus.tsx

How to use (example):
1) Put the file at: app/components/ConnectionStatus.tsx
2) In your app/page.tsx header area, import + render:

   import ConnectionStatus from './components/ConnectionStatus';
   // or: import ConnectionStatus from '@/app/components/ConnectionStatus';

   <ConnectionStatus />

This component polls GET /api/comfy-status every 3 seconds by default.
If your endpoint is different, change fetch('/api/comfy-status') inside the component.

Props:
- intervalMs?: number   // poll interval
- showLabel?: boolean   // show "Connected/Disconnected"
- compact?: boolean     // smaller pill
