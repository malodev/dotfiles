// Command vdcli keeps one virtual display alive so macOS treats the Mac as
// having an external display attached, which enables native clamshell mode
// (lid closed + AC power) without any global sleep flag.
//
// The default geometry mirrors the built-in panel of a 14" MacBook Pro
// (3024x1964 native pixels, running a 2294x1490-point scaled mode at 120 Hz),
// so the dummy can be mirrored against the internal display 1:1.
package main

import (
	"flag"
	"fmt"
	"log"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/go-macos/virtualdisplay"
)

func main() {
	w := flag.Uint("w", 3024, "width in pixels")
	h := flag.Uint("h", 1964, "height in pixels")
	rate := flag.Float64("rate", 120, "refresh rate in Hz")
	hidpi := flag.Bool("hidpi", true, "advertise Retina modes")
	name := flag.String("name", "Clamshell dummy", "display name")
	dur := flag.Duration("for", 0, "exit after this long (0 = run until interrupted)")
	flag.Parse()

	if err := virtualdisplay.Available(); err != nil {
		log.Fatalf("virtual displays unavailable: %v", err)
	}
	d, err := virtualdisplay.Open(virtualdisplay.Spec{
		Name:        *name,
		Width:       uint32(*w),
		Height:      uint32(*h),
		RefreshRate: *rate,
		HiDPI:       *hidpi,
		ExtraModes: []virtualdisplay.Mode{
			{Width: 2294, Height: 1490},
		},
	})
	if err != nil {
		log.Fatalf("open: %v", err)
	}
	fmt.Printf("virtual display up: id=%d name=%q %dx%d@%g hidpi=%v\n", d.ID(), *name, *w, *h, *rate, *hidpi)

	if *dur > 0 {
		time.Sleep(*dur)
		if err := d.Close(); err != nil {
			log.Fatalf("close: %v", err)
		}
		return
	}
	sig := make(chan os.Signal, 1)
	signal.Notify(sig, syscall.SIGINT, syscall.SIGTERM)
	<-sig
	if err := d.Close(); err != nil {
		log.Fatalf("close: %v", err)
	}
}
