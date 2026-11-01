import 'server-only'

import { FatalError } from 'workflow'

export class HarnessTimeAuthorizationExpired extends FatalError {
  constructor() {
    super('The authorized run deadline is exhausted.')
  }
}
