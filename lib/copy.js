/**
 * Page copy.
 *
 * Every heading and paragraph on the public page lives here so it can be edited
 * from the dashboard. Defaults are the shipped wording; anything the admin saves
 * overrides it, and a missing key falls back rather than rendering blank.
 *
 * Two bits of light formatting are available in any field:
 *   **bold**   emphasis in the strong colour
 *   *italic*   emphasis in the accent colour
 *   a new line becomes a line break
 * Everything is HTML-escaped first, so typing < or & is safe.
 */

const esc = s => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function rich(s) {
  return esc(s)
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/\r?\n/g, '<br>');
}

const DEFAULT_COPY = {
  hero: {
    headline: 'Your list is the',
    phrases: [
      'asset you already paid for.',
      'only channel you truly own.',
      'cheapest revenue you have.',
      'one audience that is yours.'
    ],
    lede: 'JOSION builds email and automation systems for ecommerce brands — the flows, campaigns and segmentation that turn an audience you already paid for into revenue you can forecast.',
    ctaPrimary: 'Book a strategy call',
    ctaSecondary: 'See the work',
    note: 'Free 30-minute audit of your current flows. No pitch deck.'
  },
  video: {
    heading: 'The first 72 hours decide the next twelve months.',
    body: "A subscriber is never more interested in you than the moment they hand over their address. Most brands answer that moment with a single discount code and then go quiet for a fortnight.\n\nWe treat it as a conversation with a shape: what you sell, who it's for, why you're different, what other people say, and only then a reason to buy now."
  },
  about: {
    tag: 'Who we are',
    heading: 'Most brands spend **everything** acquiring an audience and *almost nothing* talking to it.',
    beliefs: [
      { k: 'Belief', text: "**Owned beats rented.** Ad costs climb every quarter. The inbox is the one channel where you set the rules, keep the data, and don't pay again to reach the same person twice." },
      { k: 'Method', text: '**Systems, not sends.** We build lifecycle infrastructure — welcome, browse, cart, post-purchase, winback, replenishment — then layer campaigns on top of something that already earns while you sleep.' },
      { k: 'Clients', text: "**Ecommerce and DTC brands** doing real volume, usually somewhere between their first million and their first plateau, with a list they've never properly worked." },
      { k: 'Proof', text: "**Revenue or it didn't happen.** Open rates are a vanity metric. We report attributed revenue, revenue per recipient, and what changed since the month before." }
    ],
    stats: [
      { value: '38', suffix: '%', label: 'Average share of total store revenue coming from email after six months with us.' },
      { value: '12', suffix: '×', label: 'Typical return on retention spend, measured against attributed revenue.' },
      { value: '240', suffix: '+', label: 'Flows and campaigns designed, written, coded and shipped.' }
    ]
  },
  services: {
    tag: 'What we do',
    heading: 'Seven ways we\nmove the number.',
    lede: "Everything is built to be measured. If a service can't be tied to revenue, retention or reply rate, we don't sell it."
  },
  process: {
    tag: 'How we work',
    heading: 'Six weeks from\naudit to autopilot.',
    lede: "The same sequence every time, so you always know what's happening and what lands next."
  },
  work: {
    tag: 'Selected work',
    heading: 'What changed,\nand by how much.',
    lede: 'Open any project to see the brief, the strategy, the numbers, and the emails themselves — before and after.',
    note: ''
  },
  emails: {
    tag: 'Email designs',
    heading: 'Built to render\neverywhere.',
    lede: 'Table-based, dark-mode safe, and tested across Gmail, Outlook and Apple Mail. Open one to view it at full size on desktop or mobile.',
    note: 'Drag or scroll sideways. Click any design to open it.'
  },
  proof: {
    tag: 'Trust',
    heading: "What clients say\nwhen we're not there.",
    lede: 'Retention work is slow, unglamorous and compounding. These are the people who stayed for the compounding part.',
    note: ''
  },
  faq: {
    tag: 'Questions',
    heading: 'The things\neveryone asks.',
    lede: 'If something here is still unclear, put it in the call — that is what it is for.'
  },
  booking: {
    tag: 'Book a strategy call',
    heading: 'Thirty minutes.\nOne honest audit.',
    lede: "Pick a time that works. We'll look at your current flows together and tell you what we'd fix first — whether or not you hire us.",
    bullets: [
      'A walkthrough of your existing automations and where they drop off',
      'The two or three flows worth building next, ranked by revenue',
      'A rough timeline and what it would cost to do properly'
    ],
    whatsappLabel: 'Prefer WhatsApp? Message us'
  },
  final: {
    heading: 'Stop renting attention. *Start owning it.*',
    body: "You've already paid to reach these people once. Let's make the second, third and tenth conversation the one that pays for it.",
    ctaPrimary: 'Book a strategy call',
    ctaSecondary: 'Chat with us on WhatsApp'
  },
  footer: {
    description: 'An email and lifecycle marketing agency for ecommerce brands that are done guessing.'
  }
};

/** Deep-merge saved copy over the defaults so a partial save never blanks a section. */
function withDefaults(saved) {
  const out = JSON.parse(JSON.stringify(DEFAULT_COPY));
  if (!saved || typeof saved !== 'object') return out;
  Object.keys(out).forEach(section => {
    if (!saved[section]) return;
    Object.keys(out[section]).forEach(key => {
      const v = saved[section][key];
      if (v === undefined || v === null) return;
      if (Array.isArray(out[section][key]) && !Array.isArray(v)) return;
      if (Array.isArray(v) && !v.length) return;      // an empty list means "leave the default"
      if (typeof v === 'string' && !v.trim() && !['note'].includes(key)) return;
      out[section][key] = v;
    });
  });
  return out;
}

module.exports = { DEFAULT_COPY, withDefaults, rich, esc };
