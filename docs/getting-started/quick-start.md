# Quick Start

Get up and running with NetSimWeb in just a few minutes!

## Create Your First Network

### 1. Add Devices

Drag devices from the sidebar onto the canvas:

- **PC** - End-user computer
- **Router** - Routes traffic between networks
- **Switch** - Connects devices in the same network

### 2. Connect Devices

1. Click on a device to select it
2. Use the cable tool or click on interface ports
3. Connect to another device's interface

### 3. Configure IP Addresses

Click on a device to open its terminal, then configure the interface:

```
interface eth0
ip address 192.168.1.1 255.255.255.0
no shutdown
```

### 4. Test Connectivity

Use ping to test connectivity between devices:

```
ping 192.168.1.2
```

## Next Steps

- Learn about [all device types](../reference/devices.md)
- Explore [terminal commands](../guide/terminal.md)
- Read the full [user guide](../guide/interface.md)
