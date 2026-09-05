FROM docker:27-cli@sha256:851f91d241214e7c6db86513b270d58776379aacc5eb9c4a87e5b47115e3065c

RUN apk add --no-cache bash curl jq openssl

WORKDIR /opt/overlay-installer

COPY bin/overlayctl /usr/local/bin/overlayctl
COPY templates ./templates

RUN chmod 0755 /usr/local/bin/overlayctl

# SECURITY BOUNDARY: this is a short-lived installer, never an application
# service. Docker-socket access is equivalent to host-root access. The image has
# no listening port, daemon, health server, or long-running command; it exits
# after overlayctl finishes. See docs/deploy-operate/one-command-install.mdx.
# nosemgrep: dockerfile.security.missing-user.missing-user
# nosemgrep: dockerfile.security.missing-user-entrypoint.missing-user-entrypoint
ENTRYPOINT ["overlayctl"]
