// db.js — ذخیره‌سازی ساده‌ی حساب‌های کاربری روی یک فایل JSON
// (ساده‌ترین راه‌حل متناسب با پروژه‌ی Node.js فعلی، بدون نیاز به دیتابیس خارجی)

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const DB_PATH = path.join(DATA_DIR, 'accounts.json');
const MAX_AVATAR_LENGTH = 300000; // ~300KB (بعد از فشرده‌سازی سمت کلاینت، آواتار خیلی کوچک‌تر از این خواهد بود)
const MAX_USERNAME_LENGTH = 20;

function ensureDataDir() {
    if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
    }
}

function loadAccounts() {
    ensureDataDir();
    if (!fs.existsSync(DB_PATH)) return {};
    try {
        return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
    } catch (e) {
        console.error('⚠️ خطا در خواندن دیتابیس حساب‌ها:', e.message);
        return {};
    }
}

let accounts = loadAccounts();

function saveAccounts() {
    ensureDataDir();
    try {
        fs.writeFileSync(DB_PATH, JSON.stringify(accounts, null, 2));
    } catch (e) {
        console.error('⚠️ خطا در ذخیره دیتابیس حساب‌ها:', e.message);
    }
}

function isValidAvatar(avatar) {
    if (typeof avatar !== 'string' || avatar.length === 0) return false;
    if (avatar.length > MAX_AVATAR_LENGTH) return false;
    // آواتار پیش‌فرض: یک اموجی کوتاه (نه data URI)
    if (!avatar.startsWith('data:')) return avatar.length <= 8;
    // آواتار آپلودشده: باید یک data URI تصویری معتبر باشد
    return /^data:image\/(png|jpeg|jpg|webp|gif);base64,/.test(avatar);
}

function isValidUsername(username) {
    return typeof username === 'string' &&
        username.trim().length >= 2 &&
        username.trim().length <= MAX_USERNAME_LENGTH;
}

function getAccount(accountId) {
    if (!accountId) return null;
    return accounts[accountId] || null;
}

function usernameTaken(username, excludingAccountId) {
    const uname = username.trim();
    return Object.values(accounts).some(
        a => a.username === uname && a.accountId !== excludingAccountId
    );
}

function createOrUpdateAccount(accountId, { username, avatar }) {
    const existing = accounts[accountId];
    if (existing) {
        if (username) existing.username = username.trim();
        if (avatar) existing.avatar = avatar;
    } else {
        accounts[accountId] = {
            accountId,
            username: username ? username.trim() : 'بازیکن',
            avatar: avatar || '🐔',
            gamesPlayed: 0,
            wins: 0,
            losses: 0,
            createdAt: Date.now()
        };
    }
    saveAccounts();
    return accounts[accountId];
}

function recordGameResult(accountId, didWin) {
    const acc = accounts[accountId];
    if (!acc) return null;
    acc.gamesPlayed = (acc.gamesPlayed || 0) + 1;
    if (didWin) acc.wins = (acc.wins || 0) + 1;
    else acc.losses = (acc.losses || 0) + 1;
    saveAccounts();
    return acc;
}

module.exports = {
    getAccount,
    createOrUpdateAccount,
    usernameTaken,
    recordGameResult,
    isValidAvatar,
    isValidUsername
};
