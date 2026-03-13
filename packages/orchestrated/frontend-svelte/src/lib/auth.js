import Keycloak from 'keycloak-js';
import { writable } from 'svelte/store';

const keycloakUrl = import.meta.env.VITE_KEYCLOAK_URL || 'http://keycloak.localhost';
const keycloakRealm = import.meta.env.VITE_KEYCLOAK_REALM || 'lazyapps-demo';
const keycloakClientId = import.meta.env.VITE_KEYCLOAK_CLIENT_ID || 'lazyapps-frontend';

const keycloak = new Keycloak({
	url: keycloakUrl,
	realm: keycloakRealm,
	clientId: keycloakClientId
});

export const authState = writable({
	authenticated: false,
	username: null,
	sub: null,
	roles: [],
	token: null
});

const TOKEN_REFRESH_INTERVAL = 30000;
const MIN_TOKEN_VALIDITY = 60;

let refreshInterval = null;

const updateAuthState = () => {
	authState.set({
		authenticated: keycloak.authenticated,
		username: keycloak.tokenParsed?.preferred_username || null,
		sub: keycloak.tokenParsed?.sub || null,
		roles: keycloak.tokenParsed?.realm_access?.roles || [],
		token: keycloak.token || null
	});
};

const startTokenRefresh = () => {
	if (refreshInterval) clearInterval(refreshInterval);
	refreshInterval = setInterval(() => {
		keycloak
			.updateToken(MIN_TOKEN_VALIDITY)
			.then((refreshed) => {
				if (refreshed) updateAuthState();
			})
			.catch(() => {
				console.error('Token refresh failed, redirecting to login');
				keycloak.login();
			});
	}, TOKEN_REFRESH_INTERVAL);
};

export const initAuth = () =>
	keycloak
		.init({
			onLoad: 'login-required',
			checkLoginIframe: false
		})
		.then((authenticated) => {
			if (authenticated) {
				updateAuthState();
				startTokenRefresh();
			}
			return authenticated;
		});

export const logout = () => {
	if (refreshInterval) clearInterval(refreshInterval);
	return keycloak.logout();
};

export const getToken = () => keycloak.token;

export const getUserId = () => keycloak.tokenParsed?.sub;
