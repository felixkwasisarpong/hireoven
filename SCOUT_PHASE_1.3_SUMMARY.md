# Scout Phase 1.3: Safe UI Actions - Implementation Summary

## Overview
Implemented structured action system for Hireoven Scout that allows Claude to return safe, non-destructive UI actions that the frontend can execute.

## Files Created

### 1. `lib/scout/types.ts`
**Purpose:** TypeScript definitions for Scout actions and responses

**Key Types:**
- `ScoutActionType` - Union of 5 allowed action types
- `ScoutAction` - Discriminated union with typed payloads
- `ScoutRecommendation` - Apply | Skip | Improve | Wait | Explore
- `ScoutResponse` - Complete response shape with answer, recommendation, and actions

### 2. `lib/scout/actions.ts`
**Purpose:** Validation and normalization logic for actions

**Key Functions:**
- `isAllowedScoutAction(action)` - Type guard with payload validation
- `normalizeScoutActions(actions)` - Filters and caps actions to max 4
- `getDefaultActionLabel(action)` - Generates fallback labels

**Safety Features:**
- Validates action type against whitelist
- Validates payload structure for each action type
- Rejects unknown or malformed actions
- Caps response to 4 actions maximum

### 3. `components/scout/ScoutActionRenderer.tsx`
**Purpose:** Frontend component that safely executes Scout actions

**Features:**
- Only executes allowed actions via Next.js router
- Visual feedback with inline confirmation messages
- Disabled state for already-executed actions
- Icon-based action buttons with descriptions
- HIGHLIGHT_JOBS renders as visual placeholder only (not persisted)
- Never executes raw code from Claude

**UI Elements:**
- Action cards with icons and labels
- Execution feedback (3-second auto-dismiss)
- Visual confirmation for HIGHLIGHT_JOBS
- Disabled state after action execution

## Files Modified

### 4. `app/api/scout/chat/route.ts`
**Changes:**
- Updated system prompt with detailed action instructions
- Added action validation before returning response
- Integrated `normalizeScoutActions()` in response parser
- Imported `ScoutResponse` type from lib/scout/types

**System Prompt Updates:**
- Documented all 5 allowed action types with examples
- Specified that Claude should only use IDs from context
- Set max 4 actions per response
- Explained action validation happens server-side

### 5. `app/(dashboard)/dashboard/scout/page.tsx`
**Changes:**
- Imported `ScoutActionRenderer` component
- Imported `ScoutResponse` type from lib/scout/types
- Rendered `ScoutActionRenderer` below recommendation badge

## Allowed Actions

### 1. OPEN_JOB
**Purpose:** Navigate to job detail page  
**Payload:** `{ jobId: string }`  
**Navigation:** `/dashboard/jobs/[jobId]`  
**Safety:** Read-only navigation

### 2. APPLY_FILTERS
**Purpose:** Filter job feed with search criteria  
**Payload:** 
```typescript
{
  query?: string
  location?: string
  workMode?: string
  sponsorship?: "high" | "moderate" | "low"
}
```
**Navigation:** `/dashboard?q=...&location=...`  
**Safety:** Only modifies URL search params

### 3. OPEN_RESUME_TAILOR
**Purpose:** Open resume editor/tailor  
**Payload:** `{ jobId?: string, resumeId?: string }`  
**Navigation:** `/dashboard/resumes/tailor?jobId=...` or `/dashboard/resumes/[id]/edit`  
**Safety:** Read-only navigation (route may not exist yet)

### 4. HIGHLIGHT_JOBS
**Purpose:** Visual highlight only, not persisted  
**Payload:** `{ jobIds: string[], reason?: string }`  
**Execution:** Client-side state only, shows confirmation banner  
**Safety:** No persistence, no side effects

### 5. OPEN_COMPANY
**Purpose:** Navigate to company profile page  
**Payload:** `{ companyId: string }`  
**Navigation:** `/dashboard/companies/[companyId]`  
**Safety:** Read-only navigation

## Intentionally Blocked Actions

The following actions are **NOT** implemented for safety:

❌ **Save job** - Would modify database  
❌ **Auto apply** - Would submit applications without consent  
❌ **Modify resume** - Would alter user data  
❌ **Send application** - Would take action on user's behalf  
❌ **Delete/hide jobs** - Would permanently modify user's feed  
❌ **Any destructive action** - Safety policy violation  
❌ **Direct DOM manipulation** - Security risk  
❌ **Execute arbitrary code** - Security risk

## Security & Safety Features

### Server-Side
1. **Action validation** - All actions validated before returning to client
2. **Type checking** - Strict TypeScript validation on payloads
3. **ID verification** - Claude cannot invent IDs not in context
4. **Action cap** - Maximum 4 actions per response
5. **Whitelist enforcement** - Only 5 action types allowed

### Client-Side
1. **No code execution** - Actions are data structures, not code
2. **Router-only navigation** - Uses Next.js router, no window.location hacks
3. **No persistence for HIGHLIGHT_JOBS** - Visual only
4. **Execution feedback** - User sees what happened
5. **Idempotency** - Actions can be executed multiple times safely

## Testing Scenarios

### Test 1: Filter Jobs with High Sponsorship
**User Query:** "Show me backend jobs with high sponsorship"

**Expected Actions:**
```json
{
  "type": "APPLY_FILTERS",
  "payload": {
    "query": "backend",
    "sponsorship": "high"
  },
  "label": "Show backend jobs with high sponsorship"
}
```

**Result:** Navigates to `/dashboard?q=backend&sponsorship=high`

### Test 2: Open Job from Context
**User Query:** "Open this job"  
**Context:** Scout has `jobId: "abc-123"` in context

**Expected Actions:**
```json
{
  "type": "OPEN_JOB",
  "payload": { "jobId": "abc-123" },
  "label": "View this job"
}
```

**Result:** Navigates to `/dashboard/jobs/abc-123`

### Test 3: No Valid Action
**User Query:** "What's your opinion on remote work?"  
**Context:** General question, no specific job/company

**Expected Actions:** `[]`

**Result:** No action buttons shown, only conversational answer

### Test 4: Highlight Jobs (Visual Only)
**User Query:** "Show me which jobs have the best sponsorship"  
**Context:** Scout has multiple job IDs in context

**Expected Actions:**
```json
{
  "type": "HIGHLIGHT_JOBS",
  "payload": {
    "jobIds": ["job-1", "job-2", "job-3"],
    "reason": "High H-1B sponsorship likelihood"
  },
  "label": "Highlight top matches"
}
```

**Result:** Visual banner shows "3 jobs marked for your attention"

### Test 5: Improve Resume for Job
**User Query:** "Help me improve my resume for this role"  
**Context:** Scout has `jobId: "xyz-789"`

**Expected Actions:**
```json
{
  "type": "OPEN_RESUME_TAILOR",
  "payload": { "jobId": "xyz-789" },
  "label": "Tailor resume for this job"
}
```

**Result:** Navigates to resume tailor (if route exists)

## Implementation Status

✅ Type definitions (`lib/scout/types.ts`)  
✅ Action validation (`lib/scout/actions.ts`)  
✅ Frontend action executor (`ScoutActionRenderer.tsx`)  
✅ System prompt updates (API route)  
✅ Server-side validation (API route)  
✅ Frontend integration (Scout page)  
✅ Safety constraints enforced  
✅ No linter errors

## Next Steps (Future Phases)

**Phase 1.4** - Multi-turn conversations with context retention  
**Phase 2.x** - Controlled write actions (save job, update watchlist) with explicit user confirmation  
**Phase 3.x** - Proactive notifications and job alerts

## Notes

- All navigation uses Next.js `useRouter()` - no direct URL manipulation
- HIGHLIGHT_JOBS is intentionally ephemeral - no database writes
- OPEN_RESUME_TAILOR may show as disabled if route doesn't exist yet
- Actions are suggestions - users must click to execute
- Server validates all actions even though client also validates
- Maximum 4 actions per response prevents UI spam
