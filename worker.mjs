const CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz";
const CODE_LENGTH = 16;
const CODE_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_PAYLOAD_BYTES = 1024 * 1024;
const NO_STORE = { "Cache-Control": "no-store" };

function jsonResponse(body, status = 200) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { ...NO_STORE, "Content-Type": "application/json; charset=utf-8" }
	});
}

function validNotes(notes) {
	if (!notes || typeof notes !== "object" || Array.isArray(notes)) return false;
	const entries = Object.entries(notes);
	return entries.length <= 10000 && entries.every(([date, html]) =>
		/^\d{4}-\d{2}-\d{2}$/.test(date) && typeof html === "string"
	);
}

async function readJSON(request) {
	const text = await request.text();
	if (new TextEncoder().encode(text).byteLength > MAX_PAYLOAD_BYTES) {
		return { error: "Les notes dépassent la taille maximale de 1 Mo." };
	}
	try {
		return JSON.parse(text);
	} catch {
		return { error: "Le contenu envoyé n’est pas un JSON valide." };
	}
}

function generateCode() {
	let code = "";
	const limit = 256 - (256 % CODE_ALPHABET.length);
	while (code.length < CODE_LENGTH) {
		const random = crypto.getRandomValues(new Uint8Array(32));
		for (const value of random) {
			if (value >= limit) continue;
			code += CODE_ALPHABET[value % CODE_ALPHABET.length];
			if (code.length === CODE_LENGTH) break;
		}
	}
	return code;
}

function validCode(code) {
	return typeof code === "string"
		&& code.length === CODE_LENGTH
		&& [...code].every((character) => CODE_ALPHABET.includes(character));
}

export class TransferStore {
	constructor(state) {
		this.state = state;
	}

	async fetch(request) {
		const url = new URL(request.url);
		if (url.pathname === "/create" && request.method === "POST") {
			const transfer = await readJSON(request);
			if (!validNotes(transfer.notes) || !Number.isFinite(transfer.expiresAt)) {
				return jsonResponse({ error: "Les données à transférer sont invalides." }, 400);
			}
			const created = await this.state.storage.transaction(async (transaction) => {
				const existing = await transaction.get("transfer");
				if (existing && existing.expiresAt > Date.now()) return false;
				await transaction.put("transfer", transfer);
				return true;
			});
			if (!created) return jsonResponse({ error: "Code déjà existant." }, 409);
			await this.state.storage.setAlarm(transfer.expiresAt);
			return jsonResponse({ ok: true }, 201);
		}

		if (url.pathname === "/consume" && request.method === "POST") {
			const transfer = await this.state.storage.transaction(async (transaction) => {
				const saved = await transaction.get("transfer");
				if (!saved) return { status: "unavailable" };
				if (saved.expiresAt <= Date.now()) {
					await transaction.delete("transfer");
					return { status: "unavailable" };
				}
				await transaction.delete("transfer");
				return { status: "ok", notes: saved.notes };
			});
			await this.state.storage.deleteAlarm();
			if (transfer.status !== "ok") {
				return jsonResponse({ error: "Code invalide, expiré ou déjà utilisé." }, 410);
			}
			return jsonResponse({ notes: transfer.notes });
		}

		return jsonResponse({ error: "Requête inconnue." }, 404);
	}

	async alarm() {
		await this.state.storage.delete("transfer");
	}
}

async function createTransfer(request, env) {
	const body = await readJSON(request);
	if (body.error) return jsonResponse({ error: body.error }, 400);
	if (!validNotes(body.notes)) {
		return jsonResponse({ error: "Les notes à transférer sont invalides." }, 400);
	}
	const expiresAt = Date.now() + CODE_TTL_MS;
	for (let attempt = 0; attempt < 3; attempt += 1) {
		const code = generateCode();
		const objectId = env.TRANSFERS.idFromName(code);
		const response = await env.TRANSFERS.get(objectId).fetch("https://transfer.internal/create", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ notes: body.notes, expiresAt })
		});
		if (response.status === 409) continue;
		if (!response.ok) return jsonResponse({ error: "Impossible d’enregistrer le transfert." }, 500);
		return jsonResponse({ code, expiresAt }, 201);
	}
	return jsonResponse({ error: "Impossible de générer un code unique. Réessayez." }, 503);
}

async function consumeTransfer(request, env) {
	const body = await readJSON(request);
	const code = typeof body.code === "string" ? body.code.replace(/[\s-]/g, "") : "";
	if (!validCode(code)) return jsonResponse({ error: "Le code saisi est invalide." }, 400);
	const objectId = env.TRANSFERS.idFromName(code);
	return env.TRANSFERS.get(objectId).fetch("https://transfer.internal/consume", { method: "POST" });
}

export default {
	async fetch(request, env) {
		const url = new URL(request.url);
		if (url.pathname === "/api/transfers" && request.method === "POST") {
			return createTransfer(request, env);
		}
		if (url.pathname === "/api/transfers/consume" && request.method === "POST") {
			return consumeTransfer(request, env);
		}
		if (url.pathname.startsWith("/api/")) {
			return jsonResponse({ error: "Requête inconnue." }, 404);
		}
		return env.ASSETS.fetch(request);
	}
};
