export async function completeSignupVerification(signIn: () => Promise<boolean>, showVerified: () => void): Promise<void> {
  try {
    if (await signIn()) return
  } catch {}
  showVerified()
}
