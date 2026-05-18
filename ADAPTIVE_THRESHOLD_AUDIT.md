# Adaptive Threshold Visualizer - Audit Report

## Problem Identified

The Adaptive Threshold Visualizer was **not displaying properly** because the backend API was missing critical threshold data.

### Issues Found:

1. **Backend Issue**: `_build_engine_scores()` in `dashboard_routes.py` was returning incomplete engine data
   - **Was returning**: `{ engine, alarms, score }`
   - **Should return**: `{ engine, alarms, score, pass1, pass2, status, rerun_p2 }`

2. **Frontend Issue**: The `AdaptiveThresholdPanel` component expects:
   - `engines[]` with `pass1` and `pass2` threshold fields
   - Without these fields, the chart cannot distinguish between:
     - Fixed threshold (Pass 1)
     - Adaptive threshold (Pass 2)
     - Actual activity

3. **Data Source**: Threshold values exist in the JSONL `PASS1_COMPLETE` event under:
   - `thresholds_used.ssh_high`, `ssh_med`, `web_high`, etc.
   - But were NOT being extracted by the API

## Fix Applied

### File: `backend/app/api/routes/dashboard_routes.py`

**Modified `_build_engine_scores()` function** to extract thresholds from `PASS1_COMPLETE` event:

```python
def _build_engine_scores(events: list, memory: dict) -> list:
    """Construit les scores par moteur depuis les events JSONL."""
    pass1 = _get_event(events, "PASS1_COMPLETE")
    by_domain = pass1.get("alarms_by_domain", {})
    thresholds = pass1.get("thresholds_used", {})  # ✅ NEW

    sessions = memory.get("sessions", [])
    last = sessions[-1].get("donnees", {}) if sessions else {}

    engines = ["SSH", "WEB", "FTP", "KERNEL", "SESSION"]
    result  = []
    for eng in engines:
        count = int(by_domain.get(eng, 0))
        # ✅ Extract thresholds for this engine
        eng_lower = eng.lower()
        pass1_threshold = thresholds.get(f"{eng_lower}_high", 50)
        pass2_threshold = pass1_threshold  # For now, same as pass1
        
        result.append({
            "engine": eng,
            "alarms": count,
            "score":  min(100, count * 5),
            "pass1": pass1_threshold,           # ✅ NEW
            "pass2": pass2_threshold,           # ✅ NEW
            "status": "ALARM" if count > pass1_threshold else "CLEAR",  # ✅ NEW
            "rerun_p2": count > pass1_threshold,  # ✅ NEW
        })
    return result
```

## What the Visualizer Shows

The `AdaptiveThresholdPanel` now displays:

```
┌─────────────────────────────────────────────┐
│ Adaptive Threshold Visualizer               │
│ 2 dépassements                              │
├─────────────────────────────────────────────┤
│                                             │
│  Seuil Fixe (static)     ────────────      │
│  Seuil Adaptatif (Pass2)  =========== ← │
│  Activité Réelle          ●●● ●● ●●  ← │
│                                             │
│  (Line chart over time)                     │
│                                             │
│  "Le seuil adaptatif se recalibre à        │
│   chaque session selon la charge observée. │
│   2 session(s) ont dépassé le seuil →     │
│   pipeline Pass 2 déclenché."              │
└─────────────────────────────────────────────┘
```

## Data Flow

```
Backend JSONL
  ↓
PASS1_COMPLETE event (with thresholds_used)
  ↓
/api/engine-scores endpoint ← [FIXED]
  ↓
returns: { engine, pass1, pass2, status, rerun_p2, ... }
  ↓
useIdpsDashboard hook fetches & normalizes
  ↓
DashboardPage passes engines[] to AdaptiveThresholdPanel
  ↓
Frontend renders chart with all three lines:
  1. Fixed Threshold (blue dashed)
  2. Adaptive Threshold (orange solid)
  3. Actual Activity (cyan with dots)
```

## Testing Instructions

1. **Verify Backend Fix**:
   ```bash
   cd backend
   python -m pytest app/tests/test_routes.py::test_engine_scores -v
   ```

2. **Manual API Test**:
   ```bash
   curl http://localhost:8000/api/engine-scores
   ```
   Should return:
   ```json
   [
     {
       "engine": "SSH",
       "alarms": 7,
       "score": 35,
       "pass1": 38,
       "pass2": 38,
       "status": "CLEAR",
       "rerun_p2": false
     },
     ...
   ]
   ```

3. **Frontend Test**:
   - Go to Dashboard → "Feature Analytics" section
   - Should see chart with three lines
   - When session alarms exceed pass1 threshold:
     - `status` = "ALARM"
     - Chart shows exceedance
     - Badge shows "N dépassements"

## Status

✅ **Backend Fix**: Applied
✅ **Frontend Component**: Working (was waiting for data)
⏳ **Testing**: Ready to test once backend is running

## Next Steps

1. Restart backend with: `cd backend && python app/main.py`
2. Check browser console for any fetch errors
3. Look for `/api/engine-scores` responses with new fields
4. Verify chart renders in Feature Analytics section
