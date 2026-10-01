export {
  applyAppDataCapabilitiesToOverlayCapabilities,
  CONVEX_APP_DATA_CAPABILITIES,
  deriveAppDataCapabilities,
  selectedDatabaseProvider,
  type AppDataCapabilities,
  type AppDataProvider,
} from './capabilities'
export {
  UnsupportedAppDataRepositoryError,
  repositoryProxy,
  unsupportedRepository,
} from './errors'
export {
  createAppDataContext,
  type AppDataContext,
  type AppDataRepositories,
} from './repositories'
