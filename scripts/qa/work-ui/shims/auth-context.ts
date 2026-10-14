export function useAuth() {
  return { user: { id: 'user-me', email: 'me@example.com', firstName: 'Mercedes' }, isLoading: false, isAuthenticated: true, signOut: async () => undefined, refreshSession: async () => undefined }
}
