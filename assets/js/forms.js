/* SysMatica — enquiry forms (Contact, Careers)
   Valid submissions are sent to Web3Forms (web3forms.com), which emails them to sales@sysmpl.com.
   If that request fails, the visitor's email app opens with a pre-filled message instead. */
(function () {
  'use strict';

  // Web3Forms access key for sales@sysmpl.com (public by design; it can only send to that inbox).
  // Get one at https://web3forms.com. Leave empty to use the email-app fallback only.
  var ACCESS_KEY = '';

  function labelFor(form, el) {
    if (el.dataset.label) return el.dataset.label;
    var l = el.id && form.querySelector('label[for="' + el.id + '"]');
    return l ? l.textContent.replace(/[*]|\(optional\)/gi, '').trim() : el.name;
  }

  function validateField(field) {
    var input = field.querySelector('input, select, textarea');
    if (!input) return true;
    var ok = input.checkValidity();
    if (ok && input.type === 'file' && input.files[0] && input.dataset.maxmb) ok = input.files[0].size <= input.dataset.maxmb * 1048576;
    field.classList.toggle('is-invalid', !ok);
    input.setAttribute('aria-invalid', String(!ok));
    return ok;
  }

  function validateGroup(group) {
    if (!group.hasAttribute('data-required')) return true;
    var ok = !!group.querySelector('input:checked');
    group.classList.toggle('is-invalid', !ok);
    return ok;
  }

  function setHidden(form, name, value) {
    var el = form.querySelector('input[type="hidden"][name="' + name + '"]');
    if (!el) { el = document.createElement('input'); el.type = 'hidden'; el.name = name; form.appendChild(el); }
    el.value = value;
  }

  document.querySelectorAll('form[data-mailto]').forEach(function (form) {
    var fields = Array.prototype.slice.call(form.querySelectorAll('.field'));
    var groups = Array.prototype.slice.call(form.querySelectorAll('.chips-field'));
    var consentWrap = form.querySelector('.consent-wrap');
    var consent = consentWrap && consentWrap.querySelector('input');
    var wrapper = form.closest('.form');

    // Validate on blur once the visitor has interacted, and clear errors as they fix them.
    fields.forEach(function (f) {
      var input = f.querySelector('input, select, textarea');
      if (!input) return;
      input.addEventListener('blur', function () { if (input.value) validateField(f); });
      input.addEventListener('input', function () { if (f.classList.contains('is-invalid')) validateField(f); });
      input.addEventListener('change', function () { if (f.classList.contains('is-invalid')) validateField(f); });
    });
    groups.forEach(function (g) { g.addEventListener('change', function () { if (g.classList.contains('is-invalid')) validateGroup(g); }); });
    if (consent) consent.addEventListener('change', function () { consentWrap.classList.toggle('is-invalid', !consent.checked); });

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var ok = true;
      var firstBad = null;
      fields.forEach(function (f) { if (!validateField(f)) { ok = false; firstBad = firstBad || f.querySelector('input, select, textarea'); } });
      groups.forEach(function (g) { if (!validateGroup(g)) { ok = false; firstBad = firstBad || g.querySelector('input'); } });
      if (consent && !consent.checked) { consentWrap.classList.add('is-invalid'); ok = false; firstBad = firstBad || consent; }
      if (!ok) { firstBad && firstBad.focus(); return; }

      // Compose the email body in form order.
      var lines = [];
      var seenGroups = [];
      Array.prototype.forEach.call(form.elements, function (el) {
        if (!el.name || el.type === 'submit' || el.type === 'hidden' || el.type === 'file' || el.name === 'botcheck' || el === consent) return;
        if (el.type === 'checkbox' || el.type === 'radio') {
          var group = el.closest('.chips-field');
          if (!group || seenGroups.indexOf(group) > -1) return;
          seenGroups.push(group);
          var picked = Array.prototype.map.call(group.querySelectorAll('input:checked'), function (i) { return i.value; });
          var legend = group.querySelector('legend');
          lines.push((legend ? legend.textContent.replace(/[*]|\(optional\)/gi, '').trim() : el.name) + ': ' + (picked.join(', ') || '—'));
          return;
        }
        var v = (el.value || '').trim();
        if (el.tagName === 'TEXTAREA') lines.push('', labelFor(form, el) + ':', v || '—', '');
        else lines.push(labelFor(form, el) + ': ' + (v || '—'));
      });
      if (form.dataset.footer) lines.push('', form.dataset.footer);

      var subjectField = form.querySelector('[data-subject-from]');
      var subject = form.dataset.subject + (subjectField && subjectField.value ? ' — ' + subjectField.value.trim() : '');
      var href = 'mailto:' + form.dataset.mailto + '?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(lines.join('\n'));

      var copyBtn = wrapper.querySelector('[data-copy]');
      if (copyBtn) copyBtn.dataset.text = 'To: ' + form.dataset.mailto + '\nSubject: ' + subject + '\n\n' + lines.join('\n');
      var reopen = wrapper.querySelector('[data-reopen]');
      if (reopen) reopen.href = href;

      var btn = form.querySelector('[type="submit"]');
      var showDone = function () {
        wrapper.classList.add('is-sent');
        var done = wrapper.querySelector('.form-done');
        if (done) { done.setAttribute('tabindex', '-1'); done.focus({ preventScroll: true }); done.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
      };
      var fallback = function () {
        if (btn) btn.disabled = false;
        alert('Sorry, we could not send this automatically. Your email app will open with the details filled in — please press send.');
        window.location.href = href;
      };
      if (btn) btn.disabled = true;
      if (!ACCESS_KEY) { fallback(); return; }
      // Web3Forms emails each submission; replies go to the visitor's "email" field.
      setHidden(form, 'access_key', ACCESS_KEY);
      setHidden(form, 'subject', subject);
      setHidden(form, 'from_name', 'SysMatica website');
      fetch(form.action, { method: 'POST', headers: { Accept: 'application/json' }, body: new FormData(form) })
        .then(function (r) { return r.json(); })
        .then(function (j) { if (!j.success) throw new Error(j.message); if (btn) btn.disabled = false; form.reset(); showDone(); })
        .catch(fallback);
    });

    // "Copy details" fallback for visitors without a mail app.
    var copyBtn = wrapper.querySelector('[data-copy]');
    if (copyBtn) copyBtn.addEventListener('click', function () {
      var text = copyBtn.dataset.text || '';
      var label = copyBtn.querySelector('.btn-text');
      var done = function () { if (label) { label.textContent = 'Copied'; setTimeout(function () { label.textContent = 'Copy details'; }, 2000); } };
      if (navigator.clipboard) navigator.clipboard.writeText(text).then(done, function () {});
    });

    var edit = wrapper.querySelector('[data-edit]');
    if (edit) edit.addEventListener('click', function () {
      wrapper.classList.remove('is-sent');
      var first = form.querySelector('input, select, textarea');
      first && first.focus();
    });
  });
})();
