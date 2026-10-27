package bundle

import (
	"context"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"net"
	"strings"
)

// queryPostgres runs one simple-query message and returns the data rows.
// Trust authentication is the only accepted startup. The error is the server
// message, truncated, and it does not include a password.
func queryPostgres(ctx context.Context, addr, user, database, sql string) ([][]string, error) {
	var dialer net.Dialer
	conn, err := dialer.DialContext(ctx, "tcp", addr)
	if err != nil {
		return nil, err
	}
	defer conn.Close()
	if deadline, ok := ctx.Deadline(); ok {
		_ = conn.SetDeadline(deadline)
	}
	if err := writeStartup(conn, user, database); err != nil {
		return nil, err
	}
	if err := readUntilReady(conn); err != nil {
		return nil, err
	}
	if err := writeQuery(conn, sql); err != nil {
		return nil, err
	}
	return readQuery(conn)
}

func wireSize(n int) (uint32, error) {
	if n < 4 || n > 16<<20 {
		return 0, errors.New("postgres frame too large")
	}
	return uint32(n), nil
}

func writeStartup(conn net.Conn, user, database string) error {
	var body []byte
	body = binary.BigEndian.AppendUint32(body, 196608)
	body = appendCString(body, "user", user)
	body = appendCString(body, "database", database)
	body = append(body, 0)
	n, err := wireSize(len(body) + 4)
	if err != nil {
		return err
	}
	frame := binary.BigEndian.AppendUint32(nil, n)
	frame = append(frame, body...)
	_, err = conn.Write(frame)
	return err
}

func appendCString(buf []byte, key, value string) []byte {
	buf = append(buf, key...)
	buf = append(buf, 0)
	buf = append(buf, value...)
	buf = append(buf, 0)
	return buf
}

func writeQuery(conn net.Conn, sql string) error {
	payload := append([]byte(sql), 0)
	n, err := wireSize(len(payload) + 4)
	if err != nil {
		return err
	}
	frame := []byte{'Q'}
	frame = binary.BigEndian.AppendUint32(frame, n)
	frame = append(frame, payload...)
	_, err = conn.Write(frame)
	return err
}

func readMsg(conn net.Conn) (byte, []byte, error) {
	head := make([]byte, 5)
	if _, err := io.ReadFull(conn, head); err != nil {
		return 0, nil, err
	}
	n := int(binary.BigEndian.Uint32(head[1:5]))
	if n < 4 {
		return 0, nil, errors.New("short postgres frame")
	}
	body := make([]byte, n-4)
	if _, err := io.ReadFull(conn, body); err != nil {
		return 0, nil, err
	}
	return head[0], body, nil
}

func readUntilReady(conn net.Conn) error {
	for {
		kind, body, err := readMsg(conn)
		if err != nil {
			return err
		}
		switch kind {
		case 'E':
			return errors.New(errorMessage(body))
		case 'R':
			if len(body) < 4 || binary.BigEndian.Uint32(body[:4]) != 0 {
				return errors.New("postgres auth refused")
			}
		case 'Z':
			return nil
		}
	}
}

func readQuery(conn net.Conn) ([][]string, error) {
	var rows [][]string
	for {
		kind, body, err := readMsg(conn)
		if err != nil {
			return nil, err
		}
		switch kind {
		case 'D':
			row, err := parseDataRow(body)
			if err != nil {
				return nil, err
			}
			rows = append(rows, row)
		case 'E':
			return nil, errors.New(errorMessage(body))
		case 'Z':
			return rows, nil
		}
	}
}

func parseDataRow(body []byte) ([]string, error) {
	if len(body) < 2 {
		return nil, errors.New("short data row")
	}
	n := int(binary.BigEndian.Uint16(body[:2]))
	rest := body[2:]
	row := make([]string, 0, n)
	for i := 0; i < n; i++ {
		if len(rest) < 4 {
			return nil, errors.New("short data row")
		}
		raw := binary.BigEndian.Uint32(rest[:4])
		rest = rest[4:]
		if raw == 0xFFFFFFFF {
			row = append(row, "")
			continue
		}
		if raw > 16<<20 {
			return nil, errors.New("postgres field too large")
		}
		size := int(raw)
		if len(rest) < size {
			return nil, errors.New("short data row")
		}
		row = append(row, string(rest[:size]))
		rest = rest[size:]
	}
	return row, nil
}

func errorMessage(body []byte) string {
	var message string
	for len(body) > 0 {
		field := body[0]
		body = body[1:]
		if field == 0 {
			break
		}
		end := strings.IndexByte(string(body), 0)
		if end < 0 {
			break
		}
		value := string(body[:end])
		body = body[end+1:]
		if field == 'M' && message == "" {
			message = value
		}
	}
	if message == "" {
		message = "postgres query failed"
	}
	if len(message) > 400 {
		message = message[:400]
	}
	return message
}

// quoteLiteral quotes a migration filename. The name must be a base name.
func quoteLiteral(name string) (string, error) {
	if name == "" || strings.Contains(name, "/") || strings.Contains(name, "\\") || strings.Contains(name, "'") {
		return "", fmt.Errorf("migration name refused")
	}
	return "'" + name + "'", nil
}
