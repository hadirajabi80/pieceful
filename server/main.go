// Command pieceful serves the Pieceful jigsaw PWA from an embedded build.
package main

import (
	"flag"
	"log"
	"net/http"
	"os"
	"time"
)

func main() {
	addr := flag.String("addr", "", "listen address (default :8080, or :$PORT)")
	health := flag.Bool("healthcheck", false, "probe /healthz on the local server and exit 0/1 (for Docker HEALTHCHECK)")
	flag.Parse()
	if *addr == "" {
		*addr = ":8080"
		if p := os.Getenv("PORT"); p != "" {
			*addr = ":" + p
		}
	}
	if *health {
		os.Exit(probe(*addr))
	}

	site, err := newSite()
	if err != nil {
		log.Fatalf("loading embedded site: %v", err)
	}

	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		w.Write([]byte("ok"))
	})
	mux.Handle("/", site)

	srv := &http.Server{
		Addr:              *addr,
		Handler:           logRequests(mux),
		ReadHeaderTimeout: 5 * time.Second,
		IdleTimeout:       60 * time.Second,
	}
	log.Printf("Pieceful listening on http://localhost%s (%d files embedded)", *addr, len(site.files))
	log.Fatal(srv.ListenAndServe())
}

type statusWriter struct {
	http.ResponseWriter
	status int
}

func (w *statusWriter) WriteHeader(code int) {
	w.status = code
	w.ResponseWriter.WriteHeader(code)
}

func logRequests(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		sw := &statusWriter{ResponseWriter: w, status: 200}
		next.ServeHTTP(sw, r)
		if r.URL.Path == "/healthz" {
			return // health probes every 30s would drown the log
		}
		log.Printf("%s %s %d %s", r.Method, r.URL.Path, sw.status, time.Since(start).Round(time.Microsecond))
	})
}

// probe checks the running server's /healthz; used by the container health check.
func probe(addr string) int {
	host := addr
	if len(host) > 0 && host[0] == ':' {
		host = "127.0.0.1" + host
	}
	c := http.Client{Timeout: 3 * time.Second}
	res, err := c.Get("http://" + host + "/healthz")
	if err != nil {
		return 1
	}
	res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return 1
	}
	return 0
}
