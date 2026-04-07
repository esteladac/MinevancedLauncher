Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$form = New-Object Windows.Forms.Form
$form.ClientSize = New-Object System.Drawing.Size(300, 350)
$form.StartPosition = "CenterScreen"
$form.FormBorderStyle = "None"
# Paint the dark color INSTANTLY on native window creation
$form.BackColor = [System.Drawing.ColorTranslator]::FromHtml("#121016")
$form.TopMost = $true
$form.ShowInTaskbar = $false

$label = New-Object Windows.Forms.Label
$label.Text = "MINEVANCED"
$label.Font = New-Object System.Drawing.Font("Arial", 18, [System.Drawing.FontStyle]::Bold)
$label.ForeColor = [System.Drawing.ColorTranslator]::FromHtml("#7B52F4")
$label.AutoSize = $true
$label.Location = New-Object System.Drawing.Point(65, 140)

$subLabel = New-Object Windows.Forms.Label
$subLabel.Text = "Loading..."
$subLabel.Font = New-Object System.Drawing.Font("Arial", 10, [System.Drawing.FontStyle]::Regular)
$subLabel.ForeColor = [System.Drawing.ColorTranslator]::FromHtml("#FFFFFF")
$subLabel.AutoSize = $true
$subLabel.Location = New-Object System.Drawing.Point(115, 175)

$form.Controls.Add($label)
$form.Controls.Add($subLabel)

# Allow script to be killed externally
$form.ShowDialog()
