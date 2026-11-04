FROM golang:1.26.10-alpine AS build

RUN apk add --no-cache git
WORKDIR /src
COPY . .
RUN ./build.sh /out/overlay-subscriptions

FROM alpine:3.22
RUN apk add --no-cache ca-certificates
RUN addgroup -S overlay && adduser -S -G overlay overlay
COPY --from=build /out/overlay-subscriptions /usr/local/bin/overlay-subscriptions
USER overlay
EXPOSE 8317
ENTRYPOINT ["/usr/local/bin/overlay-subscriptions"]
