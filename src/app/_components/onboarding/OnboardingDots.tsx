import styles from './onboarding.module.css'

export function OnboardingDots() {
  return <div className={styles.dots} role="status" aria-label="Overlay is typing"><span /><span /><span /></div>
}
