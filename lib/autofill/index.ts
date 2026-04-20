import { getAshbyPatches } from "./ats-fillers/ashby-filler"
import { getGreenhousePatches } from "./ats-fillers/greenhouse-filler"
import { getLeverPatches } from "./ats-fillers/lever-filler"
import { FIELD_MAPPINGS, formatPhoneNumber } from "./field-mapper"
import type { AutofillProfile } from "@/types"

export type GeneratedScript = {
  script: string
  atsType: string
  estimatedFields: number
}

function buildFillData(profile: AutofillProfile): Record<string, string> {
  const data: Record<string, string> = {}

  for (const mapping of FIELD_MAPPINGS) {
    if (
      !profile.auto_fill_diversity &&
      ["gender", "ethnicity", "veteran_status", "disability_status"].includes(mapping.autofillKey)
    ) {
      continue
    }

    const raw = profile[mapping.autofillKey]
    if (raw === null || raw === undefined || raw === "") continue
    const value = mapping.transform ? mapping.transform(raw, profile) : String(raw)
    if (value) data[mapping.autofillKey as string] = value
  }

  // Salary range as combined string
  if (profile.salary_expectation_min && profile.salary_expectation_max) {
    data.salary_range = `$${profile.salary_expectation_min.toLocaleString()} - $${profile.salary_expectation_max.toLocaleString()}`
  } else if (profile.salary_expectation_min) {
    data.salary_range = `$${profile.salary_expectation_min.toLocaleString()}`
  }

  if (profile.phone) data.phone = formatPhoneNumber(profile.phone)

  return data
}

export function generateFillScript(
  profile: AutofillProfile,
  atsType: string = "generic"
): GeneratedScript {
  const fillData = buildFillData(profile)
  const customAnswers = profile.custom_answers ?? []
  const fullName = [profile.first_name, profile.last_name].filter(Boolean).join(" ")

  const atsPatchesFn: Record<string, (p: AutofillProfile) => string> = {
    greenhouse: getGreenhousePatches,
    lever: getLeverPatches,
    ashby: getAshbyPatches,
  }

  const atsPatches = atsPatchesFn[atsType]?.(profile) ?? ""
  const requiresSponsorship = profile.requires_sponsorship

  const script = `(function hireoven_autofill() {
  'use strict';

  // ── Profile data ─────────────────────────────────────────────────────────
  var PROFILE = ${JSON.stringify({ ...fillData, full_name: fullName }, null, 2)};

  var CUSTOM_ANSWERS = ${JSON.stringify(customAnswers, null, 2)};

  var REQUIRES_SPONSORSHIP = ${JSON.stringify(requiresSponsorship)};
  var AUTHORIZED_TO_WORK = ${JSON.stringify(profile.authorized_to_work)};
  var SPONSORSHIP_STATEMENT = ${JSON.stringify(profile.sponsorship_statement ?? "")};

  // ── Mappings: each maps a value to the patterns that trigger it ───────────
  var MAPPINGS = [
    { value: PROFILE.first_name, patterns: ['first.?name', 'fname', 'given.?name', '\\\\bfirst\\\\b'] },
    { value: PROFILE.last_name, patterns: ['last.?name', 'lname', 'family.?name', 'surname', '\\\\blast\\\\b'] },
    { value: PROFILE.full_name, patterns: ['\\\\bfull.?name\\\\b', '^name$', '\\\\byour.?name\\\\b'] },
    { value: PROFILE.email, patterns: ['e.?mail'] },
    { value: PROFILE.phone, patterns: ['phone', 'mobile', 'cell', 'telephone'] },
    { value: PROFILE.linkedin_url, patterns: ['linkedin'] },
    { value: PROFILE.github_url, patterns: ['github', 'git.?hub'] },
    { value: PROFILE.portfolio_url, patterns: ['portfolio', 'personal.?site', '\\\\bwebsite\\\\b'] },
    { value: PROFILE.website_url, patterns: ['website', 'personal.?website', 'web.?address'] },
    { value: PROFILE.address_line1, patterns: ['address.?line.?1', '\\\\baddress\\\\b', 'street.?address'] },
    { value: PROFILE.address_line2, patterns: ['address.?line.?2', 'apartment', '\\\\bapt\\\\b', 'suite', 'unit'] },
    { value: PROFILE.city, patterns: ['\\\\bcity\\\\b', '\\\\btown\\\\b'] },
    { value: PROFILE.state, patterns: ['\\\\bstate\\\\b', 'province'] },
    { value: PROFILE.zip_code, patterns: ['\\\\bzip\\\\b', 'postal', 'postcode'] },
    { value: PROFILE.country, patterns: ['\\\\bcountry\\\\b', 'country.?of.?residence'] },
    { value: PROFILE.years_of_experience, patterns: ['years.?of.?exp', 'exp.*years', 'how.?many.?years'] },
    { value: PROFILE.salary_range, patterns: ['salary', 'compensation', 'expected.*pay', 'desired.*pay'] },
    { value: PROFILE.earliest_start_date, patterns: ['start.?date', 'notice.?period', 'when.*start'] },
    { value: PROFILE.willing_to_relocate, patterns: ['relocat', 'willing.*move'] },
    { value: PROFILE.highest_degree, patterns: ['\\\\bdegree\\\\b', 'education.*level', 'highest.*edu'] },
    { value: PROFILE.field_of_study, patterns: ['field.*study', '\\\\bmajor\\\\b', 'area.*study'] },
    { value: PROFILE.university, patterns: ['university', 'college', '\\\\bschool\\\\b', 'institution'] },
    { value: PROFILE.graduation_year, patterns: ['grad.*year', 'graduation', 'class.*of'] },
    { value: PROFILE.gpa, patterns: ['\\\\bgpa\\\\b', 'grade.*point'] },
    { value: AUTHORIZED_TO_WORK ? 'Yes' : 'No', patterns: ['legally.*authorized', 'authorized.*work', 'eligible.*work', 'work.*authoriz'] },
    ${requiresSponsorship ? `{ value: 'Yes', patterns: ['require.*sponsor', 'need.*sponsor', 'visa.*sponsor', 'future.*sponsor', 'h.?1b'] },
    { value: SPONSORSHIP_STATEMENT, patterns: ['sponsor.*detail', 'authoriz.*explain', 'additional.*visa', 'visa.*comment'] },` : `{ value: 'No', patterns: ['require.*sponsor', 'need.*sponsor', 'visa.*sponsor'] },
    { value: SPONSORSHIP_STATEMENT, patterns: ['sponsor.*detail', 'authoriz.*explain', 'additional.*visa', 'visa.*comment'] },`}
  ].filter(function(m) { return m.value && m.value !== 'undefined' && m.value !== 'null'; });

  // ── React-safe fill helpers ───────────────────────────────────────────────
  var nativeInputSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value') && Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  var nativeTextareaSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value') && Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;

  function trigger(el) {
    ['input', 'change', 'blur'].forEach(function(type) {
      el.dispatchEvent(new Event(type, { bubbles: true }));
    });
  }

  function fillEl(el, value) {
    if (!el || !value) return false;
    try {
      if (el.tagName === 'TEXTAREA') {
        if (nativeTextareaSetter) nativeTextareaSetter.call(el, value);
        else el.value = value;
      } else {
        if (nativeInputSetter) nativeInputSetter.call(el, value);
        else el.value = value;
      }
      trigger(el);
      return true;
    } catch(e) { return false; }
  }

  function fillById(id, value) {
    var el = document.getElementById(id);
    return el ? fillEl(el, value) : false;
  }

  function fillByName(name, value) {
    var el = document.querySelector('[name="' + name + '"]');
    return el ? fillEl(el, value) : false;
  }

  function fillBySelector(selector, value) {
    var el = document.querySelector(selector);
    return el ? fillEl(el, value) : false;
  }

  function fillByAriaLabel(label, value) {
    var el = document.querySelector('[aria-label="' + label + '"], [aria-label*="' + label + '"]');
    return el ? fillEl(el, value) : false;
  }

  function fillByPlaceholder(placeholder, value) {
    var el = document.querySelector('[placeholder*="' + placeholder + '"]');
    return el ? fillEl(el, value) : false;
  }

  function getFieldText(el) {
    var parts = [];
    if (el.id) {
      var label = document.querySelector('label[for="' + el.id + '"]');
      if (label) parts.push(label.textContent || '');
    }
    parts.push(
      el.getAttribute('aria-label') || '',
      el.getAttribute('placeholder') || '',
      el.getAttribute('name') || '',
      el.id || ''
    );
    return parts.join(' ').toLowerCase().replace(/[_\\-]/g, ' ').trim();
  }

  function matches(fieldText, patterns) {
    return patterns.some(function(p) {
      try { return new RegExp(p, 'i').test(fieldText); } catch(e) { return false; }
    });
  }

  // ── ATS-specific patches ──────────────────────────────────────────────────
  ${atsPatches}

  // ── Generic fill pass ─────────────────────────────────────────────────────
  var results = { filled: [], skipped: [], errors: [] };
  var filledEls = new WeakSet();

  var selector = 'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="checkbox"]):not([type="radio"]):not([type="file"]), textarea';

  Array.from(document.querySelectorAll(selector)).forEach(function(el) {
    if (filledEls.has(el)) return;
    var style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') return;
    if (el.offsetWidth === 0 && el.offsetHeight === 0) return;

    var fieldText = getFieldText(el);
    if (!fieldText.trim()) return;

    // Custom answers take priority
    for (var i = 0; i < CUSTOM_ANSWERS.length; i++) {
      var qa = CUSTOM_ANSWERS[i];
      if (!qa || !qa.question_pattern || !qa.answer) continue;
      try {
        if (new RegExp(qa.question_pattern, 'i').test(fieldText)) {
          if (fillEl(el, qa.answer)) {
            results.filled.push(fieldText.slice(0, 50));
            filledEls.add(el);
            return;
          }
        }
      } catch(e) {}
    }

    // Standard mappings
    for (var j = 0; j < MAPPINGS.length; j++) {
      var m = MAPPINGS[j];
      if (!m.value) continue;
      if (matches(fieldText, m.patterns)) {
        if (fillEl(el, m.value)) {
          results.filled.push(fieldText.slice(0, 50));
          filledEls.add(el);
          return;
        } else {
          results.errors.push(fieldText.slice(0, 50));
          return;
        }
      }
    }

    results.skipped.push(fieldText.slice(0, 50));
  });

  // ── Visual summary overlay ────────────────────────────────────────────────
  var existing = document.getElementById('__hireoven_overlay');
  if (existing) existing.remove();

  var overlay = document.createElement('div');
  overlay.id = '__hireoven_overlay';
  overlay.style.cssText = [
    'position:fixed', 'top:16px', 'right:16px', 'z-index:2147483647',
    'background:#fff', 'border:1.5px solid #0369a1', 'border-radius:16px',
    'padding:16px 20px', 'box-shadow:0 8px 32px rgba(0,0,0,0.15)',
    'font-family:system-ui,-apple-system,sans-serif', 'max-width:300px',
    'min-width:240px', 'font-size:13px'
  ].join(';');

  overlay.innerHTML = [
    '<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">',
    '<div style="width:8px;height:8px;background:#0369a1;border-radius:50%"></div>',
    '<b style="color:#0369a1;font-size:14px;flex:1">Hireoven autofill</b>',
    '<button onclick="document.getElementById(\'__hireoven_overlay\').remove()" style="background:none;border:none;cursor:pointer;font-size:18px;color:#999;line-height:1;padding:0">×</button>',
    '</div>',
    '<p style="margin:0 0 4px;color:#111">✓ Filled <b>' + results.filled.length + '</b> fields</p>',
    results.skipped.length > 0 ? '<p style="margin:0 0 4px;color:#888">⚬ ' + results.skipped.length + ' fields need manual input</p>' : '',
    results.errors.length > 0 ? '<p style="margin:0 0 4px;color:#c00">✗ ' + results.errors.length + ' errors</p>' : '',
    '<p style="margin:8px 0 0;font-size:11px;color:#aaa;border-top:1px solid #eee;padding-top:8px">Review carefully before submitting!</p>',
  ].join('');

  document.body.appendChild(overlay);
  setTimeout(function() {
    var el = document.getElementById('__hireoven_overlay');
    if (el) el.style.transition = 'opacity 0.5s';
    if (el) el.style.opacity = '0';
    setTimeout(function() { var el2 = document.getElementById('__hireoven_overlay'); if (el2) el2.remove(); }, 500);
  }, 12000);

  return results;
})();`

  return {
    script,
    atsType,
    estimatedFields: FIELD_MAPPINGS.filter((m) => {
      const v = profile[m.autofillKey]
      return v !== null && v !== undefined && v !== ""
    }).length,
  }
}
