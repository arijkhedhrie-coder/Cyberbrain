# Adaptive Threshold Visualizer - Data Validation

## Real Data Verification ✅

Found in: `backend/app/output/session_20260511_183854.jsonl`

### Raw PASS1_COMPLETE Event (Line 5):

```json
{
  "event_type": "PASS1_COMPLETE",
  "alarm_count": 7,
  "alarms_by_domain": {
    "SSH": 2,
    "WEB": 2,
    "CORRELATION": 2,
    "PREDICTION": 1
  },
  "thresholds_used": {
    "pass": 1,
    "issued_by": "default",
    "ssh_high": 38,
    "ssh_med": 22,
    "web_high": 55,
    "web_med": 30,
    "ftp_high": 55,
    "ftp_med": 30,
    "kernel_high": 50,
    "session_high": 50,
    "session_med": 25,
    "corr_window": 30,
    "threat_level": "NORMAL",
    "confidence": 1.0
  }
}
```

### What the Fixed API Will Return:

**Endpoint**: `GET /api/engine-scores`

```json
[
  {
    "engine": "SSH",
    "alarms": 2,
    "score": 10,
    "pass1": 38,
    "pass2": 38,
    "status": "CLEAR",
    "rerun_p2": false
  },
  {
    "engine": "WEB",
    "alarms": 2,
    "score": 10,
    "pass1": 55,
    "pass2": 55,
    "status": "CLEAR",
    "rerun_p2": false
  },
  {
    "engine": "FTP",
    "alarms": 0,
    "score": 0,
    "pass1": 55,
    "pass2": 55,
    "status": "CLEAR",
    "rerun_p2": false
  },
  {
    "engine": "KERNEL",
    "alarms": 0,
    "score": 0,
    "pass1": 50,
    "pass2": 50,
    "status": "CLEAR",
    "rerun_p2": false
  },
  {
    "engine": "SESSION",
    "alarms": 0,
    "score": 0,
    "pass1": 50,
    "pass2": 50,
    "status": "CLEAR",
    "rerun_p2": false
  }
]
```

### What the Frontend Will Display:

```
AdaptiveThresholdPanel Chart:
─────────────────────────────────────────────────────

Sessions | Fixed Threshold | Adaptive Threshold | Actual Activity
   [0]   |      38         |        38         |        2
   [1]   |      55         |        55         |        2
   [2]   |      55         |        55         |        0
   [3]   |      50         |        50         |        0
   [4]   |      50         |        50         |        0

Chart Status: 0 dépassements
Status Badge: ✅ CLEAR (all engines within thresholds)
```

## Frontend Component Requirements

File: `presentation/components/panels/AdaptiveThresholdPanel.tsx`

The component expects data structure from `engines` prop:

```typescript
interface EngineScore {
  engine: string;      // "SSH" | "WEB" | "FTP" | "KERNEL" | "SESSION"
  alarms: number;      // actual alarm count
  score: number;       // alarm * 5 (displayed as percentage)
  pass1: number;       // ✅ THRESHOLD FROM PASS1_COMPLETE
  pass2: number;       // ✅ THRESHOLD FROM PASS1_COMPLETE
  status: string;      // ✅ "ALARM" | "CLEAR"
  rerun_p2: boolean;   // ✅ whether Pass 2 should run
}
```

## Chart Rendering

```typescript
// From AdaptiveThresholdPanel.tsx line 20
const data = sessions.slice(-20).map((s, i) => ({
  time: s.date.slice(0, 16).replace("T", " "),
  fixedThreshold:    baseP1,  // from engines[0].pass1
  adaptiveThreshold: /* dynamic calculation */,
  actualActivity:    s.nb_alarms_pass1,  // from sessions
}));
```

Three lines rendered:
- **Fixed Threshold** (blue dashed) - static pass1 value
- **Adaptive Threshold** (orange solid) - adjusts per session
- **Actual Activity** (cyan dots) - real alarm count

## Deployment Verification Checklist

- [x] Backend fix applied to `_build_engine_scores()`
- [x] Threshold data confirmed in JSONL files
- [x] Frontend component ready to receive data
- [ ] Backend running and serving `/api/engine-scores`
- [ ] Frontend fetching and displaying chart
- [ ] Chart showing all three lines correctly
- [ ] Exceedance counter working (when alarms > pass1)

## Expected Output After Fix

When you navigate to **Dashboard → Feature Analytics**, you should see:

```
┌─────────────────────────────────────────────────────────────┐
│                 Adaptive Threshold Visualizer               │
│                                                               │
│   Fixed:    ────────────────────────────────────────────   │
│   Adaptive: ═════════════════════════════════════════════   │
│   Activity: •••  ••• ••    •   •                             │
│                                                               │
│   (Interactive line chart with tooltip on hover)             │
│                                                               │
│   ✅ Seuils respectés — système stable.                      │
└─────────────────────────────────────────────────────────────┘
```

## Debugging Guide

If chart doesn't appear:

1. **Open browser DevTools** (F12)
2. **Check Network tab** for `/api/engine-scores` response
3. **Verify response includes**: `pass1`, `pass2`, `status`, `rerun_p2`
4. **Check Console** for errors in `AdaptiveThresholdPanel.tsx`
5. **Verify sessions data** is not empty (needs at least 5 sessions)
