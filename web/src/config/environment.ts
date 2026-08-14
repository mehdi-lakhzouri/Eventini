/**
 * `NEXT_PUBLIC_API_BASE_URL` porte le préfixe `/api/v1` : le backend le pose
 * via `setGlobalPrefix('api/v1')`, et le répéter dans chaque chemin d'appel le
 * ferait diverger au premier passage en v2.
 *
 * 🔴 Le défaut était `http://localhost:3000` — le port du serveur Next
 * lui-même. Sans `.env.local`, l'application s'appelait donc elle-même et
 * chaque requête API répondait 404 (défaut F-5). Le backend écoute sur 3001,
 * comme le déclare `backend/.env.example`.
 */
export const environment = {
  apiBaseUrl:
    process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3001/api/v1",
};
