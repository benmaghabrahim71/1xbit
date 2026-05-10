const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildGeminiPromptContext,
  buildRuleBasedRecommendation,
  extractGeminiText,
  extractServerProfile,
  formatRuleBasedRecommendation,
  normalizeChatMessages
} = require('../../fivemAdvisor');

test('extractServerProfile infers players, hardware, and script load from free-form text', () => {
  const profile = extractServerProfile({
    message: 'We run a heavy QBCore FiveM server with 96 players, 8 GB RAM, 4 vCPU, and 250 Mbps uplink. We get hitches during peak hours.'
  });

  assert.equal(profile.players, 96);
  assert.equal(profile.ramGb, 8);
  assert.equal(profile.cpuCores, 4);
  assert.equal(profile.uplinkMbps, 250);
  assert.equal(profile.scriptLoad, 'extreme');
  assert.ok(profile.issueTags.includes('script-cpu'));
});

test('buildRuleBasedRecommendation sizes higher for heavy player counts and script load', () => {
  const recommendation = buildRuleBasedRecommendation({
    players: 96,
    ramGb: 8,
    cpuCores: 4,
    uplinkMbps: 250,
    scriptLoad: 'heavy',
    issueTags: ['network'],
    text: ''
  });

  assert.equal(recommendation.recommendedRamGb, 24);
  assert.equal(recommendation.recommendedCpuVcpu, 10);
  assert.equal(recommendation.recommendedUplinkMbps, 1000);
  assert.match(recommendation.hardware.cpu, /Ryzen 7 7700X/);
  assert.ok(recommendation.priorityActions.some((entry) => /Increase memory to 24 GB/.test(entry)));
});

test('normalizeChatMessages trims invalid entries and keeps the latest question', () => {
  const normalized = normalizeChatMessages(
    [
      { role: 'user', content: ' First message ' },
      { role: 'assistant', content: 'Assistant reply' },
      { role: 'system', content: '' },
      { role: 'user', content: '   ' }
    ],
    'Current FiveM issue'
  );

  assert.deepEqual(normalized, [
    { role: 'user', content: 'First message' },
    { role: 'assistant', content: 'Assistant reply' },
    { role: 'user', content: 'Current FiveM issue' }
  ]);
});

test('formatRuleBasedRecommendation produces a structured markdown response', () => {
  const recommendation = buildRuleBasedRecommendation({
    players: 48,
    ramGb: 6,
    cpuCores: 4,
    uplinkMbps: 100,
    scriptLoad: 'moderate',
    issueTags: ['database'],
    text: ''
  });

  const formatted = formatRuleBasedRecommendation(recommendation);
  assert.match(formatted, /## Quick Diagnosis/);
  assert.match(formatted, /## Priority Actions/);
  assert.match(formatted, /Increase memory to/);
});

test('buildGeminiPromptContext includes rule-based guidance and transcript', () => {
  const recommendation = buildRuleBasedRecommendation({
    players: 32,
    ramGb: 8,
    cpuCores: 4,
    uplinkMbps: 1000,
    scriptLoad: 'moderate',
    issueTags: [],
    text: ''
  });

  const prompt = buildGeminiPromptContext(
    [{ role: 'user', content: 'How should I reduce lag on my 32-slot ESX server?' }],
    recommendation
  );

  assert.match(prompt, /HOST1TOP FiveM Performance Copilot/);
  assert.match(prompt, /Rule-based recommendation/);
  assert.match(prompt, /How should I reduce lag/);
});

test('extractGeminiText safely flattens candidate parts', () => {
  const text = extractGeminiText({
    candidates: [
      {
        content: {
          parts: [{ text: 'Part one.' }, { text: 'Part two.' }]
        }
      }
    ]
  });

  assert.equal(text, 'Part one.\nPart two.');
});
