package main

import (
	"bufio"
	"context"
	"crypto/tls"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	utls "github.com/refraction-networking/utls"
	"golang.org/x/net/proxy"
)

// ── stdin request ──

type TimeoutConfig struct {
	Connect int `json:"connect"`
	Read    int `json:"read"`
}

type ProxyConfig struct {
	Enabled bool   `json:"enabled"`
	Type    string `json:"type"`
	URL     string `json:"url"`
}

type Request struct {
	Method     string            `json:"method"`
	URL        string            `json:"url"`
	Headers    map[string]string `json:"headers"`
	Body       string            `json:"body"`
	ConfigPath string            `json:"config_path"`
	Timeout    TimeoutConfig     `json:"timeout"`
	Proxy      *ProxyConfig      `json:"proxy,omitempty"`
	ALPN       *bool             `json:"alpn,omitempty"`
}

// ── tls_config.json ──

type TLSConfig struct {
	Timeout struct {
		Connect int `json:"connect"`
		Read    int `json:"read"`
	} `json:"timeout"`
	Proxy struct {
		Enabled bool   `json:"enabled"`
		Type    string `json:"type"`
		URL     string `json:"url"`
	} `json:"proxy"`
	DNS struct {
		Servers []string `json:"servers"`
	} `json:"dns"`
	Fingerprint FingerprintConfig `json:"fingerprint"`
}

type FingerprintConfig struct {
	TLSVersionMin      string            `json:"tls_version_min"`
	TLSVersionMax      string            `json:"tls_version_max"`
	HTTP2              bool              `json:"http2"`
	GREASE             bool              `json:"grease"`
	Ciphers            []string          `json:"ciphers"`
	CompressionMethods []uint8           `json:"compression_methods"`
	Extensions         []ExtensionConfig `json:"extensions"`
}

type ExtensionConfig struct {
	Name string          `json:"name"`
	Data json.RawMessage `json:"data,omitempty"`
}

// ── cipher suite mapping ──

var cipherMap = map[string]uint16{
	"TLS_ECDHE_ECDSA_WITH_AES_128_GCM_SHA256":       tls.TLS_ECDHE_ECDSA_WITH_AES_128_GCM_SHA256,
	"TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256":          tls.TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256,
	"TLS_ECDHE_ECDSA_WITH_AES_256_GCM_SHA384":        tls.TLS_ECDHE_ECDSA_WITH_AES_256_GCM_SHA384,
	"TLS_ECDHE_RSA_WITH_AES_256_GCM_SHA384":           tls.TLS_ECDHE_RSA_WITH_AES_256_GCM_SHA384,
	"TLS_ECDHE_ECDSA_WITH_CHACHA20_POLY1305_SHA256":   tls.TLS_ECDHE_ECDSA_WITH_CHACHA20_POLY1305_SHA256,
	"TLS_ECDHE_RSA_WITH_CHACHA20_POLY1305_SHA256":     tls.TLS_ECDHE_RSA_WITH_CHACHA20_POLY1305_SHA256,
	"TLS_ECDHE_ECDSA_WITH_AES_128_CBC_SHA":            tls.TLS_ECDHE_ECDSA_WITH_AES_128_CBC_SHA,
	"TLS_ECDHE_RSA_WITH_AES_128_CBC_SHA":              tls.TLS_ECDHE_RSA_WITH_AES_128_CBC_SHA,
	"TLS_ECDHE_ECDSA_WITH_AES_256_CBC_SHA":            tls.TLS_ECDHE_ECDSA_WITH_AES_256_CBC_SHA,
	"TLS_ECDHE_RSA_WITH_AES_256_CBC_SHA":              tls.TLS_ECDHE_RSA_WITH_AES_256_CBC_SHA,
	"TLS_AES_128_GCM_SHA256":                          tls.TLS_AES_128_GCM_SHA256,
	"TLS_AES_256_GCM_SHA384":                          tls.TLS_AES_256_GCM_SHA384,
	"TLS_CHACHA20_POLY1305_SHA256":                    tls.TLS_CHACHA20_POLY1305_SHA256,
}

// ── curve mapping ──

var curveMap = map[string]utls.CurveID{
	"X25519MLKEM768":      utls.X25519MLKEM768,
	"SecP256r1MLKEM768":   utls.CurveID(4587),
	"SecP384r1MLKEM1024":  utls.CurveID(4589),
	"X25519":              utls.X25519,
	"CurveP256":           utls.CurveP256,
	"CurveP384":           utls.CurveP384,
	"CurveP521":           utls.CurveP521,
}

// ── signature algorithm mapping ──

var sigAlgMap = map[string]utls.SignatureScheme{
	"PSSWithSHA256":          utls.SignatureScheme(tls.PSSWithSHA256),
	"ECDSAWithP256AndSHA256": utls.SignatureScheme(tls.ECDSAWithP256AndSHA256),
	"Ed25519":                utls.SignatureScheme(tls.Ed25519),
	"PSSWithSHA384":          utls.SignatureScheme(tls.PSSWithSHA384),
	"PSSWithSHA512":          utls.SignatureScheme(tls.PSSWithSHA512),
	"PKCS1WithSHA256":        utls.SignatureScheme(tls.PKCS1WithSHA256),
	"PKCS1WithSHA384":        utls.SignatureScheme(tls.PKCS1WithSHA384),
	"PKCS1WithSHA512":        utls.SignatureScheme(tls.PKCS1WithSHA512),
	"ECDSAWithP384AndSHA384": utls.SignatureScheme(tls.ECDSAWithP384AndSHA384),
	"ECDSAWithP521AndSHA512": utls.SignatureScheme(tls.ECDSAWithP521AndSHA512),
	"PKCS1WithSHA1":          utls.SignatureScheme(tls.PKCS1WithSHA1),
	"ECDSAWithSHA1":          utls.SignatureScheme(tls.ECDSAWithSHA1),
}

// ── TLS version mapping ──

func parseTLSVersion(s string) uint16 {
	switch s {
	case "0x0303":
		return tls.VersionTLS12
	case "0x0304":
		return tls.VersionTLS13
	default:
		return tls.VersionTLS12
	}
}

func fatal(msg string) {
	j, _ := json.Marshal(map[string]string{"error": msg})
	os.Stderr.Write(j)
	os.Exit(1)
}

func main() {
	// 1. Read stdin
	input, err := io.ReadAll(os.Stdin)
	if err != nil {
		fatal("failed to read stdin: " + err.Error())
	}

	var req Request
	if err := json.Unmarshal(input, &req); err != nil {
		fatal("invalid request JSON: " + err.Error())
	}

	// 2. Load TLS config
	cfgData, err := os.ReadFile(req.ConfigPath)
	if err != nil {
		fatal("failed to read config: " + err.Error())
	}

	var cfg TLSConfig
	if err := json.Unmarshal(cfgData, &cfg); err != nil {
		fatal("invalid config JSON: " + err.Error())
	}

	// 3. Parse target URL
	u, err := url.Parse(req.URL)
	if err != nil {
		fatal("invalid URL: " + err.Error())
	}

	host := u.Hostname()
	port := u.Port()
	if port == "" {
		if u.Scheme == "https" {
			port = "443"
		} else {
			port = "80"
		}
	}
	addr := net.JoinHostPort(host, port)

	// 4. Build ClientHelloSpec
	includeALPN := req.ALPN != nil && *req.ALPN
	spec := buildClientHelloSpec(&cfg.Fingerprint, host, includeALPN)

	// 5. Establish TCP connection
	connectTimeout := time.Duration(req.Timeout.Connect) * time.Second
	if connectTimeout == 0 {
		connectTimeout = 30 * time.Second
	}
	readTimeout := time.Duration(req.Timeout.Read) * time.Second
	if readTimeout == 0 {
		readTimeout = 120 * time.Second
	}

	var rawConn net.Conn

	// Determine proxy: request-level overrides config-level
	proxyEnabled := false
	proxyType := ""
	proxyURL := ""
	if req.Proxy != nil && req.Proxy.Enabled {
		proxyEnabled = true
		proxyType = req.Proxy.Type
		proxyURL = req.Proxy.URL
	} else if cfg.Proxy.Enabled {
		proxyEnabled = true
		proxyType = cfg.Proxy.Type
		proxyURL = cfg.Proxy.URL
	}

	// Custom DNS resolver
	resolver := &net.Resolver{
		PreferGo: true,
		Dial: func(ctx context.Context, network, address string) (net.Conn, error) {
			dnsServer := "8.8.8.8:53"
			if len(cfg.DNS.Servers) > 0 {
				dnsServer = cfg.DNS.Servers[0]
			}
			d := net.Dialer{Timeout: connectTimeout}
			return d.DialContext(ctx, "udp", dnsServer)
		},
	}
	dialer := &net.Dialer{
		Timeout:  connectTimeout,
		Resolver: resolver,
	}

	if proxyEnabled {
		rawConn, err = dialViaProxy(proxyType, proxyURL, addr, connectTimeout)
	} else {
		rawConn, err = dialer.Dial("tcp", addr)
	}
	if err != nil {
		fatal("connection failed: " + err.Error())
	}
	defer rawConn.Close()

	// 6. uTLS handshake
	tlsConn := utls.UClient(rawConn, &utls.Config{
		ServerName:         host,
		InsecureSkipVerify: false,
	}, utls.HelloCustom)

	if err := tlsConn.ApplyPreset(&spec); err != nil {
		fatal("failed to apply TLS preset: " + err.Error())
	}

	tlsConn.SetDeadline(time.Now().Add(connectTimeout))
	if err := tlsConn.Handshake(); err != nil {
		fatal("TLS handshake failed: " + err.Error())
	}

	// 7. Send HTTP request (manual construction to preserve header order)
	tlsConn.SetDeadline(time.Now().Add(readTimeout))

	path := u.RequestURI()
	httpReq := fmt.Sprintf("%s %s HTTP/1.1\r\n", strings.ToUpper(req.Method), path)

	// Write headers in the order provided by the caller
	// Go maps don't preserve order, but the JSON decoder preserves order
	// when unmarshaling into map[string]string via iteration order (Go 1.12+: random).
	// We need to preserve the original order from JSON. Use a custom ordered approach.
	orderedHeaders := parseOrderedHeaders(input)
	hasTransferEncoding := false
	hasContentLength := false
	for _, kv := range orderedHeaders {
		httpReq += fmt.Sprintf("%s: %s\r\n", kv[0], kv[1])
		if strings.EqualFold(kv[0], "Transfer-Encoding") {
			hasTransferEncoding = true
		}
		if strings.EqualFold(kv[0], "Content-Length") {
			hasContentLength = true
		}
	}

	// If caller provided Transfer-Encoding: chunked, use chunked encoding.
	// Otherwise auto-add Content-Length for bodies (matching real client behavior:
	// only streamGenerateContent uses chunked, all other endpoints use Content-Length).
	useChunked := hasTransferEncoding
	if req.Body != "" && !hasContentLength && !hasTransferEncoding {
		httpReq += fmt.Sprintf("Content-Length: %d\r\n", len(req.Body))
	}

	httpReq += "\r\n"

	if _, err := io.WriteString(tlsConn, httpReq); err != nil {
		fatal("failed to write request headers: " + err.Error())
	}

	if req.Body != "" {
		if useChunked {
			// Write body in chunked encoding: <hex-size>\r\n<data>\r\n0\r\n\r\n
			chunk := []byte(req.Body)
			chunkHeader := fmt.Sprintf("%x\r\n", len(chunk))
			if _, err := io.WriteString(tlsConn, chunkHeader); err != nil {
				fatal("failed to write chunk header: " + err.Error())
			}
			if _, err := tlsConn.Write(chunk); err != nil {
				fatal("failed to write chunk data: " + err.Error())
			}
			if _, err := io.WriteString(tlsConn, "\r\n0\r\n\r\n"); err != nil {
				fatal("failed to write chunk terminator: " + err.Error())
			}
		} else {
			if _, err := io.WriteString(tlsConn, req.Body); err != nil {
				fatal("failed to write request body: " + err.Error())
			}
		}
	}

	// 8. Read and forward response to stdout using http.ReadResponse
	//    This properly handles chunked Transfer-Encoding and Content-Length.
	reader := bufio.NewReader(tlsConn)
	resp, err := http.ReadResponse(reader, nil)
	if err != nil {
		fatal("failed to read response: " + err.Error())
	}
	defer resp.Body.Close()

	// Write status line
	fmt.Fprintf(os.Stdout, "HTTP/%d.%d %d %s\r\n", resp.ProtoMajor, resp.ProtoMinor, resp.StatusCode, http.StatusText(resp.StatusCode))

	// Write headers (preserving all except Transfer-Encoding, since body is decoded)
	for key, values := range resp.Header {
		if strings.EqualFold(key, "Transfer-Encoding") {
			continue
		}
		for _, v := range values {
			fmt.Fprintf(os.Stdout, "%s: %s\r\n", key, v)
		}
	}
	fmt.Fprint(os.Stdout, "\r\n")

	// Stream decoded body to stdout
	io.Copy(os.Stdout, resp.Body)
}

// parseOrderedHeaders extracts headers from the raw JSON input preserving order.
func parseOrderedHeaders(raw []byte) [][2]string {
	// Parse just the "headers" field using json.Decoder to preserve order
	var wrapper struct {
		Headers json.RawMessage `json:"headers"`
	}
	if err := json.Unmarshal(raw, &wrapper); err != nil || wrapper.Headers == nil {
		return nil
	}

	var result [][2]string
	dec := json.NewDecoder(strings.NewReader(string(wrapper.Headers)))
	// Read opening {
	t, err := dec.Token()
	if err != nil || t != json.Delim('{') {
		return nil
	}

	for dec.More() {
		// Read key
		keyToken, err := dec.Token()
		if err != nil {
			break
		}
		key, ok := keyToken.(string)
		if !ok {
			break
		}
		// Read value
		valToken, err := dec.Token()
		if err != nil {
			break
		}
		val := fmt.Sprintf("%v", valToken)
		result = append(result, [2]string{key, val})
	}

	return result
}

func buildClientHelloSpec(fp *FingerprintConfig, serverName string, includeALPN bool) utls.ClientHelloSpec {
	// Cipher suites
	var cipherSuites []uint16
	for _, name := range fp.Ciphers {
		if id, ok := cipherMap[name]; ok {
			cipherSuites = append(cipherSuites, id)
		}
	}

	// Compression methods
	compressionMethods := fp.CompressionMethods
	if len(compressionMethods) == 0 {
		compressionMethods = []uint8{0}
	}

	// TLS versions
	minVer := parseTLSVersion(fp.TLSVersionMin)
	maxVer := parseTLSVersion(fp.TLSVersionMax)

	// Build extensions
	var extensions []utls.TLSExtension
	for _, ext := range fp.Extensions {
		if ext.Name == "alpn" && !includeALPN {
			continue
		}
		e := buildExtension(ext, fp, serverName)
		if e != nil {
			extensions = append(extensions, e)
		}
	}

	return utls.ClientHelloSpec{
		TLSVersMin:         minVer,
		TLSVersMax:         maxVer,
		CipherSuites:       cipherSuites,
		CompressionMethods: compressionMethods,
		Extensions:         extensions,
	}
}

func buildExtension(ext ExtensionConfig, fp *FingerprintConfig, serverName string) utls.TLSExtension {
	switch ext.Name {
	case "server_name":
		return &utls.SNIExtension{ServerName: serverName}

	case "ec_point_formats":
		return &utls.SupportedPointsExtension{
			SupportedPoints: []byte{0}, // uncompressed
		}

	case "renegotiation_info":
		return &utls.RenegotiationInfoExtension{Renegotiation: utls.RenegotiateOnceAsClient}

	case "extended_master_secret":
		return &utls.ExtendedMasterSecretExtension{}

	case "signed_certificate_timestamp":
		return &utls.SCTExtension{}

	case "status_request":
		return &utls.StatusRequestExtension{}

	case "supported_groups":
		var data struct {
			Curves []string `json:"curves"`
		}
		if ext.Data != nil {
			json.Unmarshal(ext.Data, &data)
		}
		var groups []utls.CurveID
		for _, name := range data.Curves {
			if id, ok := curveMap[name]; ok {
				groups = append(groups, id)
			}
		}
		return &utls.SupportedCurvesExtension{Curves: groups}

	case "signature_algorithms":
		var data struct {
			Algorithms []string `json:"algorithms"`
		}
		if ext.Data != nil {
			json.Unmarshal(ext.Data, &data)
		}
		var algs []utls.SignatureScheme
		for _, name := range data.Algorithms {
			if id, ok := sigAlgMap[name]; ok {
				algs = append(algs, id)
			}
		}
		return &utls.SignatureAlgorithmsExtension{SupportedSignatureAlgorithms: algs}

	case "signature_algorithms_cert":
		var data struct {
			Algorithms []string `json:"algorithms"`
		}
		if ext.Data != nil {
			json.Unmarshal(ext.Data, &data)
		}
		var algs []utls.SignatureScheme
		for _, name := range data.Algorithms {
			if id, ok := sigAlgMap[name]; ok {
				algs = append(algs, id)
			}
		}
		return &utls.SignatureAlgorithmsCertExtension{SupportedSignatureAlgorithms: algs}

	case "alpn":
		var data struct {
			Protocols []string `json:"protocols"`
		}
		if ext.Data != nil {
			json.Unmarshal(ext.Data, &data)
		}
		if len(data.Protocols) == 0 {
			data.Protocols = []string{"h2", "http/1.1"}
		}
		return &utls.ALPNExtension{AlpnProtocols: data.Protocols}

	case "supported_versions":
		var data struct {
			Versions []string `json:"versions"`
		}
		if ext.Data != nil {
			json.Unmarshal(ext.Data, &data)
		}
		var versions []uint16
		for _, v := range data.Versions {
			versions = append(versions, parseTLSVersion(v))
		}
		return &utls.SupportedVersionsExtension{Versions: versions}

	case "key_share":
		var data struct {
			Groups []string `json:"groups"`
		}
		if ext.Data != nil {
			json.Unmarshal(ext.Data, &data)
		}
		var keyShares []utls.KeyShare
		for _, name := range data.Groups {
			if id, ok := curveMap[name]; ok {
				keyShares = append(keyShares, utls.KeyShare{Group: id})
			}
		}
		return &utls.KeyShareExtension{KeyShares: keyShares}

	default:
		return nil
	}
}

func dialViaProxy(proxyType, proxyURL, target string, timeout time.Duration) (net.Conn, error) {
	switch strings.ToLower(proxyType) {
	case "socks5", "socks":
		return dialSocks5(proxyURL, target, timeout)
	case "http", "https":
		return dialHTTPProxy(proxyURL, target, timeout)
	default:
		return nil, fmt.Errorf("unsupported proxy type: %s", proxyType)
	}
}

func dialSocks5(proxyURL, target string, timeout time.Duration) (net.Conn, error) {
	u, err := url.Parse(proxyURL)
	if err != nil {
		return nil, fmt.Errorf("invalid proxy URL: %w", err)
	}

	var auth *proxy.Auth
	if u.User != nil {
		pass, _ := u.User.Password()
		auth = &proxy.Auth{
			User:     u.User.Username(),
			Password: pass,
		}
	}

	dialer, err := proxy.SOCKS5("tcp", u.Host, auth, &net.Dialer{Timeout: timeout})
	if err != nil {
		return nil, fmt.Errorf("socks5 dialer failed: %w", err)
	}

	return dialer.Dial("tcp", target)
}

func dialHTTPProxy(proxyURL, target string, timeout time.Duration) (net.Conn, error) {
	u, err := url.Parse(proxyURL)
	if err != nil {
		return nil, fmt.Errorf("invalid proxy URL: %w", err)
	}

	conn, err := net.DialTimeout("tcp", u.Host, timeout)
	if err != nil {
		return nil, fmt.Errorf("proxy connection failed: %w", err)
	}

	connectReq := fmt.Sprintf("CONNECT %s HTTP/1.1\r\nHost: %s\r\n", target, target)
	if u.User != nil {
		// Basic auth not implemented for simplicity; add if needed
	}
	connectReq += "\r\n"

	if _, err := io.WriteString(conn, connectReq); err != nil {
		conn.Close()
		return nil, fmt.Errorf("proxy CONNECT write failed: %w", err)
	}

	// Read proxy response
	br := bufio.NewReader(conn)
	statusLine, err := br.ReadString('\n')
	if err != nil {
		conn.Close()
		return nil, fmt.Errorf("proxy CONNECT read failed: %w", err)
	}

	if !strings.Contains(statusLine, "200") {
		conn.Close()
		return nil, fmt.Errorf("proxy CONNECT rejected: %s", strings.TrimSpace(statusLine))
	}

	// Drain remaining headers
	for {
		line, err := br.ReadString('\n')
		if err != nil || line == "\r\n" || line == "\n" {
			break
		}
	}

	return conn, nil
}
