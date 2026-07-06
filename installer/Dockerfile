FROM docker:27-cli

RUN apk add --no-cache bash curl jq openssl

WORKDIR /opt/overlay-installer

COPY bin/overlayctl /usr/local/bin/overlayctl
COPY templates ./templates

RUN chmod 0755 /usr/local/bin/overlayctl

# overlayctl intentionally runs as root because it writes host-mounted install
# state and must access the host Docker socket when used as an installer image.
# nosemgrep: dockerfile.security.missing-user.missing-user,dockerfile.security.missing-user-entrypoint.missing-user-entrypoint
ENTRYPOINT ["overlayctl"]
