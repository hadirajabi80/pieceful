package main

import (
	"bytes"
	"compress/gzip"
	"crypto/sha256"
	"embed"
	"encoding/hex"
	"io/fs"
	"mime"
	"net/http"
	"path"
	"strconv"
	"strings"
)

//go:embed all:dist
var distFS embed.FS

type file struct {
	body      []byte
	gz        []byte // precompressed variant, nil if not worthwhile
	etag      string
	longCache bool // artwork: stable URLs, cache for 30 days
	ctype     string
	immutable bool
}

type site struct {
	files map[string]*file // keyed by URL path, e.g. "/index.html"
}

var compressible = map[string]bool{
	".html": true, ".js": true, ".css": true, ".svg": true,
	".json": true, ".webmanifest": true, ".txt": true, ".map": true,
}

func init() {
	mime.AddExtensionType(".webmanifest", "application/manifest+json")
	mime.AddExtensionType(".js", "text/javascript; charset=utf-8")
	mime.AddExtensionType(".woff2", "font/woff2")
	mime.AddExtensionType(".svg", "image/svg+xml")
}

// newSite reads every embedded file once at startup, computing ETags and gzip variants.
func newSite() (*site, error) {
	root, err := fs.Sub(distFS, "dist")
	if err != nil {
		return nil, err
	}
	s := &site{files: map[string]*file{}}
	err = fs.WalkDir(root, ".", func(p string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() || strings.HasPrefix(d.Name(), ".") {
			return err
		}
		body, err := fs.ReadFile(root, p)
		if err != nil {
			return err
		}
		ext := path.Ext(p)
		sum := sha256.Sum256(body)
		f := &file{
			body:      body,
			etag:      `"` + hex.EncodeToString(sum[:8]) + `"`,
			ctype:     mime.TypeByExtension(ext),
			immutable: strings.HasPrefix(p, "assets/"),
			longCache: strings.HasPrefix(p, "art/"),
		}
		if f.ctype == "" {
			f.ctype = http.DetectContentType(body)
		}
		if compressible[ext] && len(body) > 1024 {
			var buf bytes.Buffer
			zw, _ := gzip.NewWriterLevel(&buf, gzip.BestCompression)
			zw.Write(body)
			zw.Close()
			if buf.Len() < len(body)*9/10 {
				f.gz = buf.Bytes()
			}
		}
		s.files["/"+p] = f
		return nil
	})
	return s, err
}

func (s *site) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		w.Header().Set("Allow", "GET, HEAD")
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	p := path.Clean("/" + r.URL.Path)
	if p == "/" {
		p = "/index.html"
	}
	f, ok := s.files[p]
	if !ok {
		// SPA fallback: extension-less routes get the app shell.
		if path.Ext(p) == "" {
			f, ok = s.files["/index.html"]
		}
		if !ok {
			http.NotFound(w, r)
			return
		}
	}

	h := w.Header()
	h.Set("Content-Type", f.ctype)
	h.Set("X-Content-Type-Options", "nosniff")
	h.Set("Referrer-Policy", "strict-origin-when-cross-origin")
	h.Set("ETag", f.etag)
	h.Add("Vary", "Accept-Encoding")
	if f.immutable {
		h.Set("Cache-Control", "public, max-age=31536000, immutable")
	} else if f.longCache {
		h.Set("Cache-Control", "public, max-age=2592000")
	} else {
		h.Set("Cache-Control", "no-cache")
	}
	if match := r.Header.Get("If-None-Match"); match != "" && strings.Contains(match, f.etag) {
		w.WriteHeader(http.StatusNotModified)
		return
	}

	body := f.body
	if f.gz != nil && strings.Contains(r.Header.Get("Accept-Encoding"), "gzip") {
		h.Set("Content-Encoding", "gzip")
		body = f.gz
	}
	h.Set("Content-Length", strconv.Itoa(len(body)))
	w.WriteHeader(http.StatusOK)
	if r.Method == http.MethodGet {
		w.Write(body)
	}
}
