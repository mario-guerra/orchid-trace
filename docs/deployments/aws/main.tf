terraform {
  required_version = ">= 1.0.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = var.aws_region
}

variable "aws_region" {
  type        = string
  default     = "us-east-1"
  description = "The AWS region to deploy resources."
}

variable "instance_type" {
  type        = string
  default     = "t3.micro" # 2 vCPU, 1 GB RAM (~$8/month)
  description = "The EC2 instance type."
}

variable "orchid_api_key" {
  type        = string
  sensitive   = true
  description = "The secure API key for the proxy container authentication."
}

# 1. VPC & Subnet
resource "aws_vpc" "vpc" {
  cidr_block           = "10.0.0.0/16"
  enable_dns_hostnames = true
  tags = {
    Name = "orchid-vpc"
  }
}

resource "aws_subnet" "subnet" {
  vpc_id                  = aws_vpc.vpc.id
  cidr_block              = "10.0.1.0/24"
  map_public_ip_on_launch = true
  tags = {
    Name = "orchid-subnet"
  }
}

resource "aws_internet_gateway" "gw" {
  vpc_id = aws_vpc.vpc.id
  tags = {
    Name = "orchid-igw"
  }
}

resource "aws_route_table" "rt" {
  vpc_id = aws_vpc.vpc.id
  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.gw.id
  }
}

resource "aws_route_table_association" "a" {
  subnet_id      = aws_subnet.subnet.id
  route_table_id = aws_route_table.rt.id
}

# 2. Security Group opening ports 4320 & 4321
resource "aws_security_group" "sg" {
  name        = "orchid-sg"
  description = "Allow proxy interceptor and control traffic"
  vpc_id      = aws_vpc.vpc.id

  ingress {
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    from_port   = 4320
    to_port     = 4320
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"] # Restrict to client IPs in production
  }

  ingress {
    from_port   = 4321
    to_port     = 4321
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"] # Restrict to developer/agent IPs in production
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

# 3. Persistent EBS Volume (gp3 SSD)
resource "aws_ebs_volume" "db_volume" {
  availability_zone = aws_instance.proxy_instance.availability_zone
  size              = 32
  type              = "gp3"
  tags = {
    Name = "orchid-db-volume"
  }
}

# 4. EC2 Instance
resource "aws_instance" "proxy_instance" {
  # Ubuntu 22.04 LTS AMI (adjust per region if needed)
  ami           = "ami-0c7217cdde317cfec" 
  instance_type = var.instance_type
  subnet_id     = aws_subnet.subnet.id

  vpc_security_group_ids = [
    aws_security_group.sg.id
  ]

  key_name = "orchid-admin-key" # Assumes key pair is already registered

  user_data = templatefile("${path.module}/cloud-init.yaml", {
    ORCHID_API_KEY = var.orchid_api_key
  })

  tags = {
    Name = "orchid-proxy-server"
  }
}

# 5. Volume Attachment
resource "aws_volume_attachment" "ebs_att" {
  device_name = "/dev/sdf"
  volume_id   = aws_ebs_volume.db_volume.id
  instance_id = aws_instance.proxy_instance.id
}

output "public_ip" {
  value       = aws_instance.proxy_instance.public_ip
  description = "The public IP of the deployed EC2 instance."
}
