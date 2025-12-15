# Terminal Commands

Use the built-in terminal to configure devices with CLI commands.

## Accessing the Terminal

1. Click on a device to select it
2. The terminal panel opens at the bottom
3. Type commands and press Enter

## Command Modes

### User Mode

Basic commands for viewing information:

```
show ip
show interfaces
ping 192.168.1.1
```

### Privileged Mode

Enter with `enable`:

```
enable
show running-config
```

### Configuration Mode

Enter with `configure terminal`:

```
configure terminal
hostname MyRouter
```

### Interface Configuration

```
interface eth0
ip address 192.168.1.1 255.255.255.0
no shutdown
exit
```

## Common Commands

| Command | Description |
|---------|-------------|
| `help` | Show available commands |
| `show ip` | Display IP configuration |
| `show interfaces` | List all interfaces |
| `show arp` | Display ARP table |
| `show mac-address-table` | Display MAC table (switches) |
| `ping <ip>` | Test connectivity |
| `traceroute <ip>` | Trace packet path |
| `clear` | Clear terminal screen |
| `clear arp` | Clear ARP cache |
| `clear mac-address-table` | Clear MAC table (switches) |

## Tips

- Use `?` after a command for help
- Tab completion is supported
- Use `exit` to go back one mode level
