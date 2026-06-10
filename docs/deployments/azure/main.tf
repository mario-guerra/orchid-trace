terraform {
  required_version = ">= 1.0.0"
  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 3.0"
    }
  }
}

provider "azurerm" {
  features {}
}

variable "location" {
  type        = string
  default     = "East US"
  description = "The Azure region to deploy resources."
}

variable "resource_group_name" {
  type        = string
  default     = "orchid-proxy-rg"
  description = "Name of the resource group."
}

variable "vm_size" {
  type        = string
  default     = "Standard_B1ms" # 1 vCPU, 2 GB RAM (~$15/month)
  description = "The size of the virtual machine."
}

variable "admin_username" {
  type        = string
  default     = "orchidadmin"
  description = "Username for VM administrator."
}

variable "orchid_api_key" {
  type        = string
  sensitive   = true
  description = "The secure API key for the proxy container authentication."
}

# 1. Resource Group
resource "azurerm_resource_group" "rg" {
  name     = var.resource_group_name
  location = var.location
}

# 2. Virtual Network & Subnet
resource "azurerm_virtual_network" "vnet" {
  name                = "orchid-vnet"
  address_space       = ["10.0.0.0/16"]
  location            = azurerm_resource_group.rg.location
  resource_group_name = azurerm_resource_group.rg.name
}

resource "azurerm_subnet" "subnet" {
  name                 = "orchid-subnet"
  resource_group_name  = azurerm_resource_group.rg.name
  virtual_network_name = azurerm_virtual_network.vnet.name
  address_prefixes     = ["10.0.1.0/24"]
}

# 3. Public IP
resource "azurerm_public_ip" "public_ip" {
  name                = "orchid-public-ip"
  location            = azurerm_resource_group.rg.location
  resource_group_name = azurerm_resource_group.rg.name
  allocation_method   = "Dynamic"
}

# 4. Network Security Group (NSG) opening ports 4320 & 4321
resource "azurerm_network_security_group" "nsg" {
  name                = "orchid-nsg"
  location            = azurerm_resource_group.rg.location
  resource_group_name = azurerm_resource_group.rg.name

  security_rule {
    name                       = "allow-ssh"
    priority                   = 1001
    direction                  = "Inbound"
    access                     = "Allow"
    protocol                   = "Tcp"
    source_port_range          = "*"
    destination_port_range     = "22"
    source_address_prefix      = "*"
    destination_address_prefix = "*"
  }

  security_rule {
    name                       = "allow-proxy-traffic"
    priority                   = 1002
    direction                  = "Inbound"
    access                     = "Allow"
    protocol                   = "Tcp"
    source_port_range          = "*"
    destination_port_range     = "4320"
    source_address_prefix      = "*" # Restrict to client IPs in production
    destination_address_prefix = "*"
  }

  security_rule {
    name                       = "allow-query-ui"
    priority                   = 1003
    direction                  = "Inbound"
    access                     = "Allow"
    protocol                   = "Tcp"
    source_port_range          = "*"
    destination_port_range     = "4321"
    source_address_prefix      = "*" # Restrict to developer/agent IPs in production
    destination_address_prefix = "*"
  }
}

# 5. Network Interface (NIC)
resource "azurerm_network_interface" "nic" {
  name                = "orchid-nic"
  location            = azurerm_resource_group.rg.location
  resource_group_name = azurerm_resource_group.rg.name

  ip_configuration {
    name                          = "internal"
    subnet_id                     = azurerm_subnet.subnet.id
    private_ip_address_allocation = "Dynamic"
    public_ip_address_id          = azurerm_public_ip.public_ip.id
  }
}

resource "azurerm_network_interface_security_group_association" "nic_nsg" {
  network_interface_id      = azurerm_network_interface.nic.id
  network_security_group_id = azurerm_network_security_group.nsg.id
}

# 6. Persistent Premium SSD Managed Disk
resource "azurerm_managed_disk" "data_disk" {
  name                 = "orchid-data-disk"
  location             = azurerm_resource_group.rg.location
  resource_group_name  = azurerm_resource_group.rg.name
  storage_account_type = "Premium_LRS"
  create_option        = "Empty"
  disk_size_gb         = 32
}

# 7. Virtual Machine
resource "azurerm_linux_virtual_machine" "vm" {
  name                = "orchid-proxy-vm"
  resource_group_name = azurerm_resource_group.rg.name
  location            = azurerm_resource_group.rg.location
  size                = var.vm_size
  admin_username      = var.admin_username

  network_interface_ids = [
    azurerm_network_interface.nic.id,
  ]

  admin_ssh_key {
    username   = var.admin_username
    public_key = file("~/.ssh/id_rsa.pub") # Adjust user's public key path as needed
  }

  os_disk {
    caching              = "ReadWrite"
    storage_account_type = "Standard_LRS"
  }

  source_image_reference {
    publisher = "Canonical"
    offer     = "0001-com-ubuntu-server-jammy"
    sku       = "22_04-lts"
    version   = "latest"
  }

  # Interpolates API Key secret into Cloud-Init YAML template
  custom_data = base64encode(templatefile("${path.module}/cloud-init.yaml", {
    ORCHID_API_KEY = var.orchid_api_key
  }))
}

# 8. Disk Attachment (Attached at /dev/sdc / LUN 0)
resource "azurerm_virtual_machine_data_disk_attachment" "disk_attach" {
  managed_disk_id    = azurerm_managed_disk.data_disk.id
  virtual_machine_id = azurerm_linux_virtual_machine.vm.id
  lun                = 0
  caching            = "ReadWrite"
}

output "public_ip_address" {
  value       = azurerm_public_ip.public_ip.ip_address
  description = "The public IP address of the deployed Orchid Proxy."
}
