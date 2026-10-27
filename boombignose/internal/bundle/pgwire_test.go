package bundle

import (
	"context"
	"encoding/binary"
	"io"
	"net"
	"strings"
	"testing"
	"time"
)

func TestQueryPostgresReadsARow(t *testing.T) {
	ln := listenPG(t)
	go func() {
		conn, err := ln.Accept()
		if err != nil {
			return
		}
		defer conn.Close()
		if err := discardStartup(conn); err != nil {
			return
		}
		writeAuthOK(conn)
		writeReady(conn)
		if err := discardQuery(conn); err != nil {
			return
		}
		writeDataRow(conn, []string{"organizations"})
		writeReady(conn)
	}()
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	rows, err := queryPostgres(ctx, ln.Addr().String(), "boombignose", "boombignose", "select to_regclass('public.organizations')")
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 1 || rows[0][0] != "organizations" {
		t.Fatalf("rows = %#v", rows)
	}
}

func TestQueryPostgresErrorOmitsSQL(t *testing.T) {
	ln := listenPG(t)
	go func() {
		conn, err := ln.Accept()
		if err != nil {
			return
		}
		defer conn.Close()
		if err := discardStartup(conn); err != nil {
			return
		}
		writeAuthOK(conn)
		writeReady(conn)
		if err := discardQuery(conn); err != nil {
			return
		}
		writeError(conn, "relation missing")
		writeReady(conn)
	}()
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	_, err := queryPostgres(ctx, ln.Addr().String(), "boombignose", "boombignose", "select hidden-sql-token")
	if err == nil {
		t.Fatal("expected an error")
	}
	if strings.Contains(err.Error(), "hidden-sql-token") {
		t.Fatalf("error included the sql: %v", err)
	}
	if !strings.Contains(err.Error(), "relation missing") {
		t.Fatalf("error = %v", err)
	}
}

func TestQuoteLiteralRefusesAQuote(t *testing.T) {
	if _, err := quoteLiteral("a'b"); err == nil {
		t.Fatal("quote must be refused")
	}
	got, err := quoteLiteral("001.sql")
	if err != nil || got != "'001.sql'" {
		t.Fatalf("got %s %v", got, err)
	}
}

func listenPG(t *testing.T) net.Listener {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = ln.Close() })
	return ln
}

func discardStartup(conn net.Conn) error {
	head := make([]byte, 4)
	if _, err := io.ReadFull(conn, head); err != nil {
		return err
	}
	n := int(binary.BigEndian.Uint32(head))
	if n < 4 {
		return io.ErrUnexpectedEOF
	}
	_, err := io.ReadFull(conn, make([]byte, n-4))
	return err
}

func discardQuery(conn net.Conn) error {
	head := make([]byte, 5)
	if _, err := io.ReadFull(conn, head); err != nil {
		return err
	}
	n := int(binary.BigEndian.Uint32(head[1:5]))
	if n < 4 {
		return io.ErrUnexpectedEOF
	}
	_, err := io.ReadFull(conn, make([]byte, n-4))
	return err
}

func putMsg(conn net.Conn, kind byte, payload []byte) {
	frame := []byte{kind}
	frame = binary.BigEndian.AppendUint32(frame, uint32(len(payload)+4))
	frame = append(frame, payload...)
	_, _ = conn.Write(frame)
}

func writeAuthOK(conn net.Conn) {
	var payload []byte
	payload = binary.BigEndian.AppendUint32(payload, 0)
	putMsg(conn, 'R', payload)
}

func writeReady(conn net.Conn) {
	putMsg(conn, 'Z', []byte{'I'})
}

func writeError(conn net.Conn, message string) {
	payload := append([]byte{'M'}, message...)
	payload = append(payload, 0, 0)
	putMsg(conn, 'E', payload)
}

func writeDataRow(conn net.Conn, cols []string) {
	payload := binary.BigEndian.AppendUint16(nil, uint16(len(cols)))
	for _, col := range cols {
		payload = binary.BigEndian.AppendUint32(payload, uint32(len(col)))
		payload = append(payload, col...)
	}
	putMsg(conn, 'D', payload)
}
