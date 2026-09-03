/*! ask-ai-widget v0.1.3 — the open-source ask-ai-widget project, release tag v0.1.3
 *  Vendored 2026-09-03 for the newspaper reader (/calendar). MIT License, Copyright (c) 2026 Sho Jikumaru.
 *  No tracking, no external requests. Update by replacing this file with the tagged release. */
(function () {
  'use strict';

  var DEFAULT_SERVICE_IDS = ['chatgpt', 'claude', 'perplexity', 'gemini'];
  var SERVICES = Object.freeze({
    chatgpt: Object.freeze({
      id: 'chatgpt',
      name: 'ChatGPT',
      mode: 'prefill',
      baseUrl: 'https://chatgpt.com/?q='
    }),
    claude: Object.freeze({
      id: 'claude',
      name: 'Claude',
      mode: 'prefill',
      baseUrl: 'https://claude.ai/new?q='
    }),
    perplexity: Object.freeze({
      id: 'perplexity',
      name: 'Perplexity',
      mode: 'prefill',
      baseUrl: 'https://www.perplexity.ai/search?q='
    }),
    gemini: Object.freeze({
      id: 'gemini',
      name: 'Gemini',
      mode: 'copy',
      baseUrl: 'https://gemini.google.com/app'
    })
  });

  function parseServices(raw) {
    if (typeof raw !== 'string' || raw.trim() === '') {
      return DEFAULT_SERVICE_IDS.slice();
    }

    var parsed = raw.split(',').map(function (value) {
      return value.trim().toLowerCase();
    }).filter(function (serviceId, index, values) {
      return Object.prototype.hasOwnProperty.call(SERVICES, serviceId) &&
        values.indexOf(serviceId) === index;
    });

    return parsed.length > 0 ? parsed : DEFAULT_SERVICE_IDS.slice();
  }

  function parseRevealAfter(raw) {
    if (typeof raw !== 'string' && typeof raw !== 'number') {
      return 0;
    }

    var value = Number(raw);

    return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
  }

  function parseFadeMs(raw) {
    if (typeof raw !== 'string' && typeof raw !== 'number') {
      return 300;
    }

    if (typeof raw === 'string' && raw.trim() === '') {
      return 300;
    }

    var value = Number(raw);

    return Number.isFinite(value) && value >= 0 ? Math.min(Math.floor(value), 5000) : 300;
  }

  function buildQuestion(template, page) {
    var questionTemplate = String(template);
    var url = String(page && page.url !== undefined ? page.url : '');
    var title = String(page && page.title !== undefined ? page.title : '');

    return questionTemplate.replace(/\{(url|title)\}/g, function (placeholder, name) {
      return name === 'url' ? url : title;
    });
  }

  function buildServiceUrl(serviceId, question) {
    var service = SERVICES[serviceId];

    if (!service) {
      return null;
    }

    if (service.mode === 'copy') {
      return { mode: service.mode, url: service.baseUrl };
    }

    return {
      mode: service.mode,
      url: service.baseUrl + encodeURIComponent(String(question))
    };
  }

  function findOwnScript() {
    if (document.currentScript) {
      return document.currentScript;
    }

    var candidates = document.querySelectorAll('script[src*="widget.js"]');
    return candidates.length > 0 ? candidates[candidates.length - 1] : null;
  }

  function readConfig(script) {
    function valueOrDefault(attribute, fallback) {
      var value = script.getAttribute(attribute);
      return value === null || value.trim() === '' ? fallback : value;
    }

    var position = valueOrDefault('data-position', 'right').toLowerCase();

    return {
      label: valueOrDefault('data-label', 'AIに聞いてみる'),
      questionTemplate: valueOrDefault(
        'data-question',
        '{url} がどんなサービスか調べて、私に合いそうか教えて'
      ),
      serviceIds: parseServices(script.getAttribute('data-services')),
      color: valueOrDefault('data-color', '#4f46e5'),
      position: position === 'left' ? 'left' : 'right',
      url: valueOrDefault('data-url', window.location.href),
      revealAfter: parseRevealAfter(script.getAttribute('data-reveal-after')),
      fadeMs: parseFadeMs(script.getAttribute('data-fade-ms'))
    };
  }

  function addStyles() {
    if (document.getElementById('askai-widget-styles')) {
      return;
    }

    var style = document.createElement('style');
    style.id = 'askai-widget-styles';
    style.textContent = [
      '.askai-root {',
      '  --askai-accent: #4f46e5;',
      '  --askai-fade-ms: 300ms;',
      '  position: fixed;',
      '  bottom: calc(16px + env(safe-area-inset-bottom, 0px));',
      '  z-index: 2147483000;',
      '  color: #111827;',
      '  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;',
      '  font-size: 16px;',
      '  line-height: 1.5;',
      '  opacity: 1;',
      '  transition: opacity var(--askai-fade-ms, 300ms) ease, visibility 0s linear 0s;',
      '}',
      '.askai-root.askai-right { right: 16px; }',
      '.askai-root.askai-left { left: 16px; }',
      '.askai-root.askai-unrevealed { visibility: hidden; opacity: 0; }',
      '.askai-root.askai-revealing { pointer-events: none; }',
      '.askai-root *, .askai-root *::before, .askai-root *::after { box-sizing: border-box; }',
      '.askai-root .askai-launcher {',
      '  display: block;',
      '  margin-left: auto;',
      '  border: 0;',
      '  border-radius: 999px;',
      '  padding: 12px 20px;',
      '  background: var(--askai-accent);',
      '  color: #ffffff;',
      '  font: inherit;',
      '  font-weight: 700;',
      '  cursor: pointer;',
      '  box-shadow: 0 8px 24px rgba(17, 24, 39, 0.22);',
      '  transition: transform 160ms ease, box-shadow 160ms ease;',
      '}',
      '.askai-root.askai-left .askai-launcher { margin-left: 0; margin-right: auto; }',
      '.askai-root .askai-launcher:hover { transform: translateY(-1px); box-shadow: 0 10px 28px rgba(17, 24, 39, 0.27); }',
      '.askai-root .askai-launcher:focus-visible, .askai-root .askai-button:focus-visible, .askai-root .askai-close:focus-visible, .askai-root .askai-textarea:focus-visible {',
      '  outline: 3px solid #ffffff;',
      '  outline-offset: 3px;',
      '  box-shadow: 0 0 0 5px var(--askai-accent);',
      '}',
      '.askai-root .askai-panel {',
      '  position: absolute;',
      '  right: 0;',
      '  bottom: calc(100% + 12px);',
      '  width: 320px;',
      '  max-width: calc(100vw - 32px);',
      '  padding: 20px;',
      '  border: 1px solid rgba(17, 24, 39, 0.1);',
      '  border-radius: 16px;',
      '  background: #ffffff;',
      '  box-shadow: 0 16px 40px rgba(17, 24, 39, 0.22);',
      '  animation: askai-panel-in 160ms ease-out;',
      '}',
      '.askai-root.askai-left .askai-panel { left: 0; right: auto; }',
      '.askai-root .askai-panel[hidden], .askai-root .askai-manual[hidden], .askai-root .askai-toast[hidden] { display: none; }',
      '.askai-root .askai-heading { margin: 0 36px 14px 0; font-size: 17px; font-weight: 700; line-height: 1.4; }',
      '.askai-root .askai-close {',
      '  position: absolute;',
      '  top: 12px;',
      '  right: 12px;',
      '  width: 32px;',
      '  height: 32px;',
      '  border: 0;',
      '  border-radius: 50%;',
      '  background: transparent;',
      '  color: #4b5563;',
      '  font: inherit;',
      '  font-size: 22px;',
      '  line-height: 1;',
      '  cursor: pointer;',
      '}',
      '.askai-root .askai-close:hover { background: #f3f4f6; }',
      '.askai-root .askai-services { display: grid; gap: 8px; }',
      '.askai-root .askai-button {',
      '  width: 100%;',
      '  border: 1px solid #d1d5db;',
      '  border-radius: 10px;',
      '  padding: 10px 14px;',
      '  background: #ffffff;',
      '  color: #111827;',
      '  font: inherit;',
      '  font-weight: 600;',
      '  text-align: left;',
      '  cursor: pointer;',
      '}',
      '.askai-root .askai-button:hover { border-color: var(--askai-accent); color: var(--askai-accent); }',
      '.askai-root .askai-manual { margin-top: 14px; }',
      '.askai-root .askai-instruction { margin: 0 0 8px; color: #374151; font-size: 13px; }',
      '.askai-root .askai-textarea {',
      '  display: block;',
      '  width: 100%;',
      '  min-height: 104px;',
      '  resize: vertical;',
      '  border: 1px solid #9ca3af;',
      '  border-radius: 8px;',
      '  padding: 9px;',
      '  background: #f9fafb;',
      '  color: #111827;',
      '  font-family: inherit;',
      '  font-size: 16px;',
      '  line-height: 1.5;',
      '}',
      '.askai-root .askai-toast {',
      '  width: 100%;',
      '  margin-top: 14px;',
      '  border-radius: 10px;',
      '  padding: 10px 14px;',
      '  background: #111827;',
      '  color: #ffffff;',
      '  font-size: 13px;',
      '  box-shadow: 0 8px 24px rgba(17, 24, 39, 0.2);',
      '}',
      '@keyframes askai-panel-in {',
      '  from { opacity: 0; transform: translateY(6px); }',
      '  to { opacity: 1; transform: translateY(0); }',
      '}',
      '@media (prefers-reduced-motion: reduce) {',
      '  .askai-root { transition: none; }',
      '  .askai-root .askai-panel { animation: none; }',
      '  .askai-root .askai-launcher { transition: none; }',
      '}'
    ].join('\n');
    document.head.appendChild(style);
  }

  function mount(config) {
    if (!document.body || document.getElementById('askai-widget-root')) {
      return;
    }

    addStyles();

    var question = buildQuestion(config.questionTemplate, {
      url: config.url,
      title: document.title
    });
    var root = document.createElement('div');
    var panel = document.createElement('div');
    var heading = document.createElement('h2');
    var closeButton = document.createElement('button');
    var servicesContainer = document.createElement('div');
    var launcher = document.createElement('button');
    var manual = document.createElement('div');
    var instruction = document.createElement('p');
    var textarea = document.createElement('textarea');
    var toast = document.createElement('div');
    var isOpen = false;
    var toastTimer = null;

    function removeClassName(element, className) {
      element.className = element.className.replace(' ' + className, '');
    }

    function revealRoot() {
      var shouldUseRevealingClass = config.fadeMs !== 0;

      if (shouldUseRevealingClass && typeof window.matchMedia === 'function') {
        shouldUseRevealingClass = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      }

      if (shouldUseRevealingClass) {
        var revealTimer = null;
        var didCleanup = false;
        var handleTransitionEnd = function (event) {
          if (event.target === root && event.propertyName === 'opacity') {
            cleanupReveal();
          }
        };
        var cleanupReveal = function () {
          if (didCleanup) {
            return;
          }

          didCleanup = true;
          removeClassName(root, 'askai-revealing');
          root.removeEventListener('transitionend', handleTransitionEnd);
          if (revealTimer !== null) {
            window.clearTimeout(revealTimer);
            revealTimer = null;
          }
        };

        root.addEventListener('transitionend', handleTransitionEnd);
        revealTimer = window.setTimeout(cleanupReveal, config.fadeMs + 100);
        root.className = root.className.replace(' askai-unrevealed', ' askai-revealing');
        return;
      }

      root.className = root.className.replace(' askai-unrevealed', '');
    }

    root.id = 'askai-widget-root';
    root.className = 'askai-root askai-' + config.position;
    root.style.setProperty('--askai-accent', config.color);

    if (config.revealAfter > 0 && window.scrollY < config.revealAfter) {
      root.style.setProperty('--askai-fade-ms', config.fadeMs + 'ms');
      root.className += ' askai-unrevealed';
      var revealOnScroll = function () {
        if (window.scrollY >= config.revealAfter) {
          revealRoot();
          window.removeEventListener('scroll', revealOnScroll);
        }
      };
      window.addEventListener('scroll', revealOnScroll, { passive: true });
    }

    panel.className = 'askai-panel';
    panel.hidden = true;
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-labelledby', 'askai-dialog-title');

    heading.id = 'askai-dialog-title';
    heading.className = 'askai-heading';
    heading.textContent = 'AIサービスを選ぶ';

    closeButton.className = 'askai-close';
    closeButton.type = 'button';
    closeButton.setAttribute('aria-label', '閉じる');
    closeButton.textContent = '×';

    servicesContainer.className = 'askai-services';

    manual.className = 'askai-manual';
    manual.hidden = true;
    instruction.className = 'askai-instruction';
    instruction.textContent = '質問文をコピーして Gemini に貼り付けてください。';
    textarea.className = 'askai-textarea';
    textarea.readOnly = true;
    textarea.setAttribute('aria-label', 'Gemini に貼り付ける質問文');
    manual.appendChild(instruction);
    manual.appendChild(textarea);

    toast.className = 'askai-toast';
    toast.hidden = true;
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-live', 'polite');

    launcher.className = 'askai-launcher';
    launcher.type = 'button';
    launcher.textContent = config.label;
    launcher.setAttribute('aria-haspopup', 'dialog');
    launcher.setAttribute('aria-expanded', 'false');

    function openPanel() {
      if (isOpen) {
        return;
      }

      isOpen = true;
      panel.hidden = false;
      launcher.setAttribute('aria-expanded', 'true');
      closeButton.focus();
    }

    function closePanel() {
      if (!isOpen) {
        return;
      }

      isOpen = false;
      panel.hidden = true;
      launcher.setAttribute('aria-expanded', 'false');
      launcher.focus();
    }

    function showToast() {
      if (toastTimer !== null) {
        window.clearTimeout(toastTimer);
      }
      toast.textContent = '質問文をコピーしました。Gemini に貼り付けてください';
      toast.hidden = false;
      toastTimer = window.setTimeout(function () {
        toast.hidden = true;
        toastTimer = null;
      }, 4000);
    }

    function showManualCopy() {
      textarea.value = question;
      manual.hidden = false;
      textarea.focus();
      textarea.select();
      try {
        textarea.setSelectionRange(0, textarea.value.length);
      } catch (error) {
        // Some browsers do not support setSelectionRange on all textarea states.
      }
    }

    function copyForGemini() {
      if (!navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') {
        showManualCopy();
        return;
      }

      try {
        Promise.resolve(navigator.clipboard.writeText(question)).then(showToast, showManualCopy);
      } catch (error) {
        showManualCopy();
      }
    }

    config.serviceIds.forEach(function (serviceId) {
      var service = SERVICES[serviceId];
      var target = buildServiceUrl(serviceId, question);
      var button = document.createElement('button');

      button.className = 'askai-button';
      button.type = 'button';
      button.textContent = service.name;
      button.addEventListener('click', function () {
        if (target.mode === 'copy') {
          copyForGemini();
        }
        window.open(target.url, '_blank', 'noopener,noreferrer');
      });
      servicesContainer.appendChild(button);
    });

    closeButton.addEventListener('click', closePanel);
    launcher.addEventListener('click', function () {
      if (isOpen) {
        closePanel();
      } else {
        openPanel();
      }
    });
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && isOpen) {
        closePanel();
        return;
      }

      if (event.key === 'Tab' && isOpen) {
        var controls = Array.prototype.filter.call(
          panel.querySelectorAll('button, textarea'),
          function (control) {
            return !control.disabled && control.tabIndex !== -1 &&
              !control.closest('[hidden]');
          }
        );
        var firstControl = controls[0];
        var lastControl = controls[controls.length - 1];

        if (!firstControl || !lastControl) {
          return;
        }

        if (!panel.contains(document.activeElement)) {
          event.preventDefault();
          firstControl.focus();
        } else if (event.shiftKey && document.activeElement === firstControl) {
          event.preventDefault();
          lastControl.focus();
        } else if (!event.shiftKey && document.activeElement === lastControl) {
          event.preventDefault();
          firstControl.focus();
        }
      }
    });
    document.addEventListener('pointerdown', function (event) {
      if (isOpen && !root.contains(event.target)) {
        closePanel();
      }
    });

    panel.appendChild(heading);
    panel.appendChild(closeButton);
    panel.appendChild(servicesContainer);
    panel.appendChild(manual);
    panel.appendChild(toast);
    root.appendChild(panel);
    root.appendChild(launcher);
    document.body.appendChild(root);
  }

  function initialize() {
    var script = findOwnScript();
    if (!script) {
      return;
    }

    var config = readConfig(script);
    if (document.body) {
      mount(config);
    } else {
      document.addEventListener('DOMContentLoaded', function () {
        mount(config);
      }, { once: true });
    }
  }

  if (typeof document !== 'undefined' && typeof window !== 'undefined') {
    initialize();
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      parseServices: parseServices,
      parseRevealAfter: parseRevealAfter,
      parseFadeMs: parseFadeMs,
      buildQuestion: buildQuestion,
      buildServiceUrl: buildServiceUrl,
      SERVICES: SERVICES
    };
  }
}());
