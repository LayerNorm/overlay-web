FROM docker:27-cli

RUN apk add --no-cache bash curl jq openssl

WORKDIR /opt/overlay-installer

COPY bin/overlayctl /usr/local/bin/overlayctl
COPY templates ./templates

RUN chmod 0755 /usr/local/bin/overlayctl

ENTRYPOINT ["overlayctl"]
