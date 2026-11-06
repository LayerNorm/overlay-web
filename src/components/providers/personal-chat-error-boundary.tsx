'use client'

import { Component, type Context, type ReactNode } from 'react'

type PersonalChatErrorBoundaryProps<T> = {
  children: ReactNode
  context: Context<T>
  fallbackChildren: ReactNode
  fallbackValue: T
  resetKey: string
}

type PersonalChatErrorBoundaryState = {
  failed: boolean
  resetKey: string
}

export class PersonalChatErrorBoundary<T> extends Component<
  PersonalChatErrorBoundaryProps<T>,
  PersonalChatErrorBoundaryState
> {
  constructor(props: PersonalChatErrorBoundaryProps<T>) {
    super(props)
    this.state = { failed: false, resetKey: props.resetKey }
  }

  static getDerivedStateFromProps<T>(
    props: PersonalChatErrorBoundaryProps<T>,
    state: PersonalChatErrorBoundaryState,
  ) {
    return props.resetKey !== state.resetKey
      ? { failed: false, resetKey: props.resetKey }
      : null
  }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  render() {
    if (!this.state.failed) return this.props.children
    const Context = this.props.context
    return (
      <Context.Provider value={this.props.fallbackValue}>
        {this.props.fallbackChildren}
      </Context.Provider>
    )
  }
}
