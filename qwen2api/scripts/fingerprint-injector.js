(function() {
    // 攔截 String.prototype.charAt
    const originalCharAt = String.prototype.charAt;
    let capturedData = null;

    String.prototype.charAt = function(index) {
        if (this.length > 200 && this.includes('^') && !capturedData) {
            const fields = this.split('^');
            if (fields.length === 37) {
                capturedData = this.toString();
                console.log('\n=== 檢測到瀏覽器指紋 ===');
                console.log(capturedData);

                // 恢復原方法
                String.prototype.charAt = originalCharAt;
            }
        }
        return originalCharAt.call(this, index);
    };
})();
