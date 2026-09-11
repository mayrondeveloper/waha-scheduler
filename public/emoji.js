// Emojis do seletor do editor: lista embutida, sem biblioteca e sem internet.
// O que não estiver aqui dá para inserir pelo painel de emojis do sistema.

const RECENT_KEY = 'waha-scheduler:recent-emojis';
const RECENT_MAX = 20;
const list = (emojis) => emojis.split(' ');

/** Categorias na ordem do seletor. */
export const EMOJI_CATEGORIES = [
  {
    id: 'faces',
    label: 'Rostos',
    emojis: list('😀 😃 😄 😁 😆 😅 😂 🤣 😊 😇 🙂 🙃 😉 😍 🥰 😘 😋 😎 🤩 🥳 😏 🤔 🤗 🤭 😴 😌 😬 🙄 😮 😲 😳 🥺 😢 😭 😤 😡 🤯 😱 🤑 🤓'),
  },
  {
    id: 'people',
    label: 'Gestos e pessoas',
    emojis: list('👍 👎 👏 🙌 🙏 🤝 👋 ✌️ 🤞 👌 🤙 💪 👉 👈 👆 👇 ☝️ ✋ 🤚 🖐️ 👊 ✊ 🫶 👀 🧠 🗣️ 👤 👥 🧑‍💻 👩‍🏫 👨‍🏫 🧑‍🎓 👶 👨‍👩‍👧 💃 🕺 🏃 🙋 🤷 🙆'),
  },
  {
    id: 'nature',
    label: 'Natureza e comida',
    emojis: list('🌞 🌙 ⭐ 🌟 ✨ ⚡ 🔥 🌈 ☀️ 🌧️ ❄️ 🌊 🌱 🌳 🌸 🌻 🍀 🍁 🐶 🐱 🦁 🐼 🦋 🐝 🍎 🍊 🍋 🍉 🍓 🍕 🍔 🍟 🍫 🍰 🎂 ☕ 🍺 🥂 🍷 🍿'),
  },
  {
    id: 'objects',
    label: 'Objetos',
    emojis: list('📚 📖 📕 📗 📘 📙 📓 📝 ✏️ 🖊️ 📌 📍 📎 🔗 📅 📆 ⏰ ⏳ 📢 📣 📱 💻 🖥️ 📷 🎥 🎧 🎁 🎉 🎊 🛒 🛍️ 💰 💵 💳 🏷️ 📦 🚚 🏠 🏆 🎯'),
  },
  {
    id: 'symbols',
    label: 'Símbolos',
    emojis: list('✅ ☑️ ✔️ ❌ ❎ ⚠️ 🚫 ❗ ❓ ‼️ ⁉️ 💯 🔴 🟠 🟡 🟢 🔵 🟣 ⚫ ⚪ ❤️ 🧡 💛 💚 💙 💜 🖤 🤍 💔 💕 ➡️ ⬅️ ⬆️ ⬇️ 🔝 🆕 🆓 🔔 ♻️ 💬'),
  },
];

/**
 * Emojis usados por último, do mais recente para o mais antigo.
 * @param {Storage|undefined} storage Normalmente o localStorage.
 * @returns {string[]}
 */
export function recentEmojis(storage) {
  // O armazenamento pode não existir ou lançar (navegação privada, bloqueio
  // do navegador). Sem ele, a aba Recentes só fica vazia: não é erro da tela.
  try {
    const parsed = JSON.parse(storage?.getItem(RECENT_KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((e) => typeof e === 'string').slice(0, RECENT_MAX) : [];
  } catch {
    return [];
  }
}

/**
 * Registra um emoji como o mais recente.
 * @param {Storage|undefined} storage
 * @param {string} emoji
 * @returns {string[]} A lista atualizada.
 */
export function rememberEmoji(storage, emoji) {
  const next = [emoji, ...recentEmojis(storage).filter((e) => e !== emoji)].slice(0, RECENT_MAX);
  try {
    storage?.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // Mesmo motivo de recentEmojis: sem armazenamento, a lista vale só agora.
  }
  return next;
}
